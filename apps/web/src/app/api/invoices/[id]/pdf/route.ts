import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateInvoicePDF, type InvoiceData } from '@/lib/invoices/pdf-generator';
import { InvoiceStorageService } from '@/lib/invoices/storage-service';

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

    // Fetch invoice data with related information
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        *,
        customer:customers(
          id,
          full_name,
          email,
          phone,
          account_number,
          billing_address
        ),
        items:invoice_items(
          id,
          description,
          quantity,
          unit_price,
          amount
        )
      `)
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Fetch tenant settings for branding
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, settings')
      .eq('id', tenantId)
      .single();

    // Parse addresses
    const parseAddress = (addressStr: string | null) => {
      if (!addressStr) return undefined;
      try {
        return JSON.parse(addressStr);
      } catch {
        return undefined;
      }
    };

    // Prepare invoice data for PDF generation
    const invoiceData: InvoiceData = {
      // Tenant info
      tenantName: tenant?.name || 'Water Utility Company',
      tenantLogo: tenant?.settings?.logo_url,
      tenantAddress: tenant?.settings?.address ? parseAddress(tenant.settings.address) : undefined,
      tenantEmail: tenant?.settings?.contact_email,
      tenantPhone: tenant?.settings?.contact_phone,
      
      // Invoice details
      invoiceNumber: invoice.invoice_number,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      status: invoice.status,
      
      // Customer info
      customerName: invoice.customer?.full_name || 'Unknown Customer',
      customerAddress: parseAddress(invoice.customer?.billing_address),
      customerEmail: invoice.customer?.email,
      customerPhone: invoice.customer?.phone,
      accountNumber: invoice.customer?.account_number,
      
      // Line items
      items: invoice.items?.map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        amount: item.amount,
      })) || [],
      
      // Totals
      subtotal: invoice.subtotal || 0,
      tax: invoice.tax_amount || 0,
      taxRate: invoice.tax_rate,
      discount: invoice.discount_amount,
      discountRate: invoice.discount_rate,
      total: invoice.total_amount,
      amountPaid: invoice.amount_paid,
      balanceDue: invoice.balance_due,
      
      // Payment info
      paymentInstructions: tenant?.settings?.payment_instructions,
      bankDetails: tenant?.settings?.bank_details,
      
      // Custom theme
      primaryColor: tenant?.settings?.primary_color,
      accentColor: tenant?.settings?.accent_color,
    };

    // Generate PDF buffer
    const pdfBuffer = await generateInvoicePDF(invoiceData);

    // Initialize storage service
    const storageService = new InvoiceStorageService(supabase);

    // Upload to storage
    const { path, error: uploadError } = await storageService.uploadInvoicePDF(
      tenantId,
      invoice.invoice_number,
      pdfBuffer,
      {
        upsert: true,
        cacheControl: '3600',
      }
    );

    if (uploadError) {
      return NextResponse.json(
        { error: `Failed to upload PDF: ${uploadError}` },
        { status: 500 }
      );
    }

    // Update invoice with PDF path
    const { error: updateError } = await supabase
      .from('invoices')
      .update({ 
        pdf_path: path,
        pdf_generated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('Failed to update invoice with PDF path:', updateError);
    }

    // Get signed URL for immediate access
    const { url, error: urlError } = await storageService.getSignedUrl(path, 3600); // 1 hour

    if (urlError) {
      return NextResponse.json(
        { error: `Failed to generate signed URL: ${urlError}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      path,
      url,
      message: 'Invoice PDF generated and uploaded successfully',
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate invoice PDF' },
      { status: 500 }
    );
  }
}

// GET - Retrieve existing PDF or generate new one
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
    
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const download = searchParams.get('download') === 'true';
    const expiresIn = parseInt(searchParams.get('expiresIn') || '3600', 10);
    const redirect = searchParams.get('redirect') === 'true';

    // Fetch invoice to check PDF path
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('invoice_number, pdf_path, pdf_generated_at')
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    const storageService = new InvoiceStorageService(supabase);

    // Check if PDF exists
    let path = invoice.pdf_path;
    let wasGenerated = false;
    
    if (!path) {
      // Generate new PDF if it doesn't exist
      const generateResponse = await POST(request, { params });
      const result = await generateResponse.json();
      
      if (!generateResponse.ok) {
        return NextResponse.json(result, { status: generateResponse.status });
      }
      
      path = result.path;
      wasGenerated = true;
    }

    // Get signed URL with specified expiration (max 7 days)
    const maxExpiry = 7 * 24 * 3600; // 7 days in seconds
    const actualExpiry = Math.min(expiresIn, maxExpiry);
    const { url, error: urlError } = await storageService.getSignedUrl(path, actualExpiry);

    if (urlError) {
      return NextResponse.json(
        { error: `Failed to get PDF URL: ${urlError}` },
        { status: 500 }
      );
    }

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + actualExpiry * 1000).toISOString();

    // If redirect parameter is true, redirect to the signed URL
    if (redirect && url) {
      return NextResponse.redirect(url);
    }

    // If download parameter is true, add download headers
    if (download && url) {
      const response = NextResponse.json({
        url,
        filename: `invoice-${invoice.invoice_number}.pdf`,
        expiresAt,
        expiresIn: actualExpiry,
      });
      
      response.headers.set(
        'Content-Disposition',
        `attachment; filename="invoice-${invoice.invoice_number}.pdf"`
      );
      
      return response;
    }

    // Return JSON response with URL and metadata
    return NextResponse.json({
      url,
      path,
      filename: `invoice-${invoice.invoice_number}.pdf`,
      expiresAt,
      expiresIn: actualExpiry,
      invoiceNumber: invoice.invoice_number,
      generatedAt: invoice.pdf_generated_at,
      wasGenerated,
      actions: {
        download: `/api/invoices/${invoiceId}/pdf?download=true`,
        view: `/api/invoices/${invoiceId}/pdf?redirect=true`,
        regenerate: wasGenerated ? null : `/api/invoices/${invoiceId}/pdf`,
      },
    });
  } catch (error) {
    console.error('Get PDF error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve invoice PDF' },
      { status: 500 }
    );
  }
}

// DELETE - Remove PDF from storage
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

    // Fetch invoice to get PDF path
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('pdf_path')
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    if (!invoice.pdf_path) {
      return NextResponse.json(
        { error: 'No PDF found for this invoice' },
        { status: 404 }
      );
    }

    // Delete from storage
    const storageService = new InvoiceStorageService(supabase);
    const { error: deleteError } = await storageService.deleteInvoicePDF(invoice.pdf_path);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete PDF: ${deleteError}` },
        { status: 500 }
      );
    }

    // Clear PDF path in database
    const { error: updateError } = await supabase
      .from('invoices')
      .update({ 
        pdf_path: null,
        pdf_generated_at: null,
      })
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('Failed to clear PDF path:', updateError);
    }

    return NextResponse.json({
      success: true,
      message: 'Invoice PDF deleted successfully',
    });
  } catch (error) {
    console.error('Delete PDF error:', error);
    return NextResponse.json(
      { error: 'Failed to delete invoice PDF' },
      { status: 500 }
    );
  }
}