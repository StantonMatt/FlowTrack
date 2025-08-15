import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, renderEmailTemplate, formatEmailWithName } from './mailer';
import { InvoiceEmail } from './templates/invoice-email';
import { InvoiceStorageService } from '@/lib/invoices/storage-service';
import { format } from 'date-fns';

export interface InvoiceEmailOptions {
  invoiceId: string;
  tenantId: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  attachPdf?: boolean;
  includePaymentLink?: boolean;
  customMessage?: string;
  resend?: boolean; // If true, allows resending even if already sent
}

export interface InvoiceEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  emailLogId?: string;
}

export class InvoiceEmailService {
  private supabase: SupabaseClient;
  private storageService: InvoiceStorageService;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase || createClient();
    this.storageService = new InvoiceStorageService(this.supabase);
  }

  /**
   * Send an invoice email
   */
  async sendInvoiceEmail(options: InvoiceEmailOptions): Promise<InvoiceEmailResult> {
    try {
      // Fetch invoice with related data
      const { data: invoice, error: invoiceError } = await this.supabase
        .from('invoices')
        .select(`
          *,
          customer:customers(
            id,
            full_name,
            email,
            phone,
            billing_address
          ),
          items:invoice_items(
            description,
            quantity,
            unit_price,
            amount
          )
        `)
        .eq('id', options.invoiceId)
        .eq('tenant_id', options.tenantId)
        .single();

      if (invoiceError || !invoice) {
        throw new Error('Invoice not found');
      }

      // Check if already sent (unless resending)
      if (!options.resend) {
        const { data: existingEmail } = await this.supabase
          .from('invoice_emails')
          .select('id')
          .eq('invoice_id', options.invoiceId)
          .eq('status', 'sent')
          .single();

        if (existingEmail) {
          return {
            success: false,
            error: 'Invoice email has already been sent. Use resend option to send again.',
          };
        }
      }

      // Fetch tenant settings
      const { data: tenant } = await this.supabase
        .from('tenants')
        .select('name, settings')
        .eq('id', options.tenantId)
        .single();

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      // Determine recipient email(s)
      const recipients = options.to || invoice.customer?.email;
      if (!recipients) {
        throw new Error('No recipient email address found');
      }

      // Format amounts
      const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: tenant.settings?.currency || 'USD',
        }).format(amount);
      };

      // Generate URLs
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.flowtrack.com';
      const viewInvoiceUrl = `${baseUrl}/${tenant.settings?.subdomain || options.tenantId}/invoices/${invoice.invoice_number}`;
      
      // Get signed PDF URL if available
      let downloadPdfUrl: string | undefined;
      if (invoice.pdf_path) {
        const { url } = await this.storageService.getSignedUrl(invoice.pdf_path, 7 * 24 * 3600); // 7 days
        downloadPdfUrl = url;
      }

      // Payment URL (if Stripe is configured)
      const paymentUrl = invoice.stripe_payment_link || 
        (tenant.settings?.stripe_enabled && invoice.status !== 'paid' 
          ? `${baseUrl}/${tenant.settings?.subdomain || options.tenantId}/pay/${invoice.invoice_number}`
          : undefined);

      // Prepare email template data
      const templateData = {
        // Tenant branding
        tenantName: tenant.name,
        tenantLogo: tenant.settings?.logo_url,
        tenantAddress: tenant.settings?.address,
        tenantPhone: tenant.settings?.contact_phone,
        tenantEmail: tenant.settings?.contact_email || tenant.settings?.billing_email,
        primaryColor: tenant.settings?.primary_color || '#0066cc',
        
        // Customer info
        customerName: invoice.customer?.full_name || 'Customer',
        customerEmail: invoice.customer?.email,
        
        // Invoice details
        invoiceNumber: invoice.invoice_number,
        invoiceDate: format(new Date(invoice.issue_date), 'MMM dd, yyyy'),
        dueDate: format(new Date(invoice.due_date), 'MMM dd, yyyy'),
        totalAmount: formatCurrency(invoice.total_amount),
        currency: tenant.settings?.currency || 'USD',
        
        // Summary items
        summaryItems: invoice.items?.map((item: any) => ({
          description: item.description,
          amount: formatCurrency(item.amount),
        })) || [],
        
        // Action URLs
        viewInvoiceUrl,
        downloadPdfUrl,
        paymentUrl,
        
        // Options
        includePaymentButton: options.includePaymentLink !== false,
        includeDownloadButton: true,
        customMessage: options.customMessage,
      };

      // Render email HTML
      const html = await renderEmailTemplate(
        InvoiceEmail(templateData)
      );

      // Prepare attachments if requested
      const attachments = [];
      if (options.attachPdf && invoice.pdf_path) {
        const { data: pdfBlob } = await this.storageService.downloadInvoicePDF(invoice.pdf_path);
        if (pdfBlob) {
          const buffer = Buffer.from(await pdfBlob.arrayBuffer());
          attachments.push({
            filename: `invoice-${invoice.invoice_number}.pdf`,
            content: buffer,
            contentType: 'application/pdf',
          });
        }
      }

      // Send email
      const emailResult = await sendEmail({
        to: recipients,
        cc: options.cc,
        bcc: options.bcc,
        subject: `Invoice ${invoice.invoice_number} from ${tenant.name}`,
        html,
        from: formatEmailWithName(
          tenant.settings?.billing_email || process.env.RESEND_FROM_EMAIL || 'noreply@flowtrack.com',
          tenant.name
        ),
        replyTo: tenant.settings?.contact_email,
        attachments,
        tags: [
          { name: 'type', value: 'invoice' },
          { name: 'invoice_id', value: invoice.id },
          { name: 'tenant_id', value: options.tenantId },
        ],
      });

      if (!emailResult.success) {
        throw new Error(emailResult.error || 'Failed to send email');
      }

      // Log email in database
      const { data: emailLog, error: logError } = await this.supabase
        .from('invoice_emails')
        .insert({
          invoice_id: options.invoiceId,
          tenant_id: options.tenantId,
          message_id: emailResult.id,
          sent_at: new Date().toISOString(),
          sent_to: Array.isArray(recipients) ? recipients : [recipients],
          sent_cc: options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : null,
          sent_bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : null,
          status: 'sent',
          template: 'invoice',
          metadata: {
            attachPdf: options.attachPdf,
            includePaymentLink: options.includePaymentLink,
            resend: options.resend,
          },
        })
        .select('id')
        .single();

      if (logError) {
        console.error('Failed to log email:', logError);
      }

      // Update invoice status if first send
      if (!options.resend && invoice.status === 'draft') {
        await this.supabase
          .from('invoices')
          .update({ 
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
          .eq('id', options.invoiceId)
          .eq('tenant_id', options.tenantId);
      }

      return {
        success: true,
        messageId: emailResult.id,
        emailLogId: emailLog?.id,
      };
    } catch (error) {
      console.error('Invoice email error:', error);
      
      // Log failed attempt
      try {
        await this.supabase
          .from('invoice_emails')
          .insert({
            invoice_id: options.invoiceId,
            tenant_id: options.tenantId,
            sent_at: new Date().toISOString(),
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            metadata: options,
          });
      } catch (logError) {
        console.error('Failed to log email error:', logError);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send invoice email',
      };
    }
  }

  /**
   * Get email history for an invoice
   */
  async getInvoiceEmailHistory(invoiceId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('invoice_emails')
      .select('*')
      .eq('invoice_id', invoiceId)
      .eq('tenant_id', tenantId)
      .order('sent_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Check if invoice has been sent
   */
  async isInvoiceSent(invoiceId: string, tenantId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('invoice_emails')
      .select('id')
      .eq('invoice_id', invoiceId)
      .eq('tenant_id', tenantId)
      .eq('status', 'sent')
      .limit(1)
      .single();

    return !!data;
  }

  /**
   * Get last sent email for invoice
   */
  async getLastSentEmail(invoiceId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('invoice_emails')
      .select('*')
      .eq('invoice_id', invoiceId)
      .eq('tenant_id', tenantId)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data;
  }

  /**
   * Send batch invoice emails
   */
  async sendBatchInvoiceEmails(
    invoiceIds: string[],
    tenantId: string,
    options?: Partial<InvoiceEmailOptions>
  ): Promise<Map<string, InvoiceEmailResult>> {
    const results = new Map<string, InvoiceEmailResult>();

    // Process in parallel with concurrency limit
    const concurrencyLimit = 5;
    const chunks = [];
    
    for (let i = 0; i < invoiceIds.length; i += concurrencyLimit) {
      chunks.push(invoiceIds.slice(i, i + concurrencyLimit));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(async (invoiceId) => {
        const result = await this.sendInvoiceEmail({
          ...options,
          invoiceId,
          tenantId,
        });
        results.set(invoiceId, result);
      });

      await Promise.all(promises);
    }

    return results;
  }
}