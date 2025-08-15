import { createClient } from '@/lib/supabase/client';
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';

export interface BillingCycle {
  id: string;
  name: string;
  frequency: 'monthly' | 'bimonthly' | 'quarterly' | 'annually';
  billingDay: number;
  dueDays: number;
  isActive: boolean;
}

export interface RateStructure {
  id: string;
  name: string;
  rateType: 'flat' | 'tiered' | 'seasonal' | 'time_of_use';
  baseRate: number;
  tiers?: RateTier[];
}

export interface RateTier {
  id: string;
  tierStart: number;
  tierEnd: number | null;
  rate: number;
  description: string;
}

export interface Invoice {
  id: string;
  customerId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  status: 'draft' | 'pending' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'void';
  periodStart: Date;
  periodEnd: Date;
  consumption: number;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  items: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  lineNumber: number;
  itemType: 'consumption' | 'fee' | 'tax' | 'discount' | 'adjustment' | 'credit';
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: number;
  taxAmount: number;
}

export class BillingService {
  private supabase = createClient();

  /**
   * Generate invoices for a billing period
   */
  async generateInvoices(
    tenantId: string,
    billingPeriodId: string
  ): Promise<{ success: number; failed: number; errors: any[] }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[],
    };

    try {
      // Get billing period details
      const { data: period, error: periodError } = await this.supabase
        .from('billing_periods')
        .select(`
          *,
          billing_cycles!inner (*)
        `)
        .eq('id', billingPeriodId)
        .single();

      if (periodError || !period) {
        throw new Error('Billing period not found');
      }

      // Get all active customers
      const { data: customers, error: customersError } = await this.supabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'active');

      if (customersError || !customers) {
        throw new Error('Failed to fetch customers');
      }

      // Get rate structure
      const { data: rateStructure } = await this.supabase
        .from('rate_structures')
        .select(`
          *,
          rate_tiers (*)
        `)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single();

      // Process each customer
      for (const customer of customers) {
        try {
          const invoice = await this.generateCustomerInvoice(
            customer,
            period,
            rateStructure
          );
          
          if (invoice) {
            results.success++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            customerId: customer.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Update billing period status
      await this.supabase
        .from('billing_periods')
        .update({
          status: 'completed',
          total_invoices: results.success,
          updated_at: new Date().toISOString(),
        })
        .eq('id', billingPeriodId);

      return results;
    } catch (error) {
      console.error('Invoice generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate invoice for a single customer
   */
  async generateCustomerInvoice(
    customer: any,
    billingPeriod: any,
    rateStructure: any
  ): Promise<string | null> {
    // Get consumption for the period
    const { data: readings } = await this.supabase
      .from('meter_readings')
      .select('*')
      .eq('customer_id', customer.id)
      .gte('reading_date', billingPeriod.period_start)
      .lte('reading_date', billingPeriod.period_end)
      .order('reading_date', { ascending: false });

    if (!readings || readings.length === 0) {
      return null; // No readings for this period
    }

    // Calculate total consumption
    const totalConsumption = readings.reduce((sum, r) => sum + (r.consumption || 0), 0);
    
    // Get the first and last readings
    const currentReading = readings[0];
    const previousReading = readings[readings.length - 1];

    // Calculate charges based on rate structure
    const charges = await this.calculateCharges(
      totalConsumption,
      rateStructure,
      customer
    );

    // Generate invoice number
    const { data: invoiceNumber } = await this.supabase
      .rpc('generate_invoice_number', {
        p_tenant_id: customer.tenant_id,
      });

    // Create invoice
    const { data: invoice, error } = await this.supabase
      .from('invoices')
      .insert({
        tenant_id: customer.tenant_id,
        customer_id: customer.id,
        billing_period_id: billingPeriod.id,
        invoice_number: invoiceNumber,
        invoice_date: new Date().toISOString(),
        due_date: this.calculateDueDate(billingPeriod.due_date),
        status: 'draft',
        period_start: billingPeriod.period_start,
        period_end: billingPeriod.period_end,
        previous_reading_id: previousReading.id,
        current_reading_id: currentReading.id,
        previous_reading: previousReading.reading_value,
        current_reading: currentReading.reading_value,
        consumption: totalConsumption,
        subtotal: charges.subtotal,
        tax_amount: charges.taxAmount,
        discount_amount: charges.discountAmount,
        total_amount: charges.totalAmount,
        paid_amount: 0,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Create invoice line items
    await this.createInvoiceItems(invoice.id, charges.items);

    return invoice.id;
  }

  /**
   * Calculate charges based on consumption and rate structure
   */
  async calculateCharges(
    consumption: number,
    rateStructure: any,
    customer: any
  ): Promise<{
    subtotal: number;
    taxAmount: number;
    discountAmount: number;
    totalAmount: number;
    items: any[];
  }> {
    const items = [];
    let subtotal = 0;

    if (rateStructure.rate_type === 'tiered' && rateStructure.rate_tiers) {
      // Calculate tiered pricing
      let remainingConsumption = consumption;
      let lineNumber = 1;

      for (const tier of rateStructure.rate_tiers.sort((a: any, b: any) => a.tier_start - b.tier_start)) {
        if (remainingConsumption <= 0) break;

        const tierConsumption = tier.tier_end
          ? Math.min(remainingConsumption, tier.tier_end - tier.tier_start)
          : remainingConsumption;

        const tierAmount = tierConsumption * tier.rate;
        subtotal += tierAmount;

        items.push({
          line_number: lineNumber++,
          item_type: 'consumption',
          description: tier.description || `Tier ${lineNumber - 1}: ${tier.tier_start}-${tier.tier_end || '+'} gallons`,
          quantity: tierConsumption,
          unit_price: tier.rate,
          amount: tierAmount,
          tax_rate: 0,
          tax_amount: 0,
        });

        remainingConsumption -= tierConsumption;
      }
    } else {
      // Flat rate pricing
      const amount = consumption * rateStructure.base_rate;
      subtotal = amount;

      items.push({
        line_number: 1,
        item_type: 'consumption',
        description: 'Water consumption',
        quantity: consumption,
        unit_price: rateStructure.base_rate,
        amount,
        tax_rate: 0,
        tax_amount: 0,
      });
    }

    // Add fixed charges if any
    const { data: template } = await this.supabase
      .from('billing_templates')
      .select('*')
      .eq('tenant_id', customer.tenant_id)
      .eq('is_active', true)
      .single();

    if (template && template.fixed_charges) {
      let lineNumber = items.length + 1;
      for (const charge of template.fixed_charges) {
        items.push({
          line_number: lineNumber++,
          item_type: 'fee',
          description: charge.description,
          quantity: 1,
          unit_price: charge.amount,
          amount: charge.amount,
          tax_rate: 0,
          tax_amount: 0,
        });
        subtotal += charge.amount;
      }
    }

    // Calculate tax
    const taxRate = template?.tax_rate || 0;
    const taxAmount = subtotal * (taxRate / 100);

    if (taxAmount > 0) {
      items.push({
        line_number: items.length + 1,
        item_type: 'tax',
        description: `Tax (${taxRate}%)`,
        quantity: 1,
        unit_price: taxAmount,
        amount: taxAmount,
        tax_rate: taxRate,
        tax_amount: 0,
      });
    }

    // Check for discounts
    const discountAmount = 0; // Implement discount logic as needed

    const totalAmount = subtotal + taxAmount - discountAmount;

    return {
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      items,
    };
  }

  /**
   * Create invoice line items
   */
  async createInvoiceItems(invoiceId: string, items: any[]): Promise<void> {
    if (items.length === 0) return;

    const { error } = await this.supabase
      .from('invoice_items')
      .insert(
        items.map(item => ({
          invoice_id: invoiceId,
          ...item,
        }))
      );

    if (error) {
      console.error('Failed to create invoice items:', error);
      throw error;
    }
  }

  /**
   * Calculate due date
   */
  private calculateDueDate(baseDueDate: string): string {
    const date = new Date(baseDueDate);
    return date.toISOString();
  }

  /**
   * Send invoice to customer
   */
  async sendInvoice(invoiceId: string): Promise<boolean> {
    try {
      // Get invoice details
      const { data: invoice, error } = await this.supabase
        .from('invoices')
        .select(`
          *,
          customers!inner (*),
          invoice_items (*)
        `)
        .eq('id', invoiceId)
        .single();

      if (error || !invoice) {
        throw new Error('Invoice not found');
      }

      // Generate PDF (implement PDF generation)
      const pdfUrl = await this.generateInvoicePDF(invoice);

      // Send email (implement email service)
      await this.sendInvoiceEmail(invoice, pdfUrl);

      // Update invoice status
      await this.supabase
        .from('invoices')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', invoiceId);

      return true;
    } catch (error) {
      console.error('Failed to send invoice:', error);
      return false;
    }
  }

  /**
   * Generate invoice PDF
   */
  private async generateInvoicePDF(invoice: any): Promise<string> {
    // Implement PDF generation logic
    // This would typically use a library like @react-pdf/renderer
    // or call an external PDF generation service
    
    // For now, return a placeholder URL
    return `/api/invoices/${invoice.id}/pdf`;
  }

  /**
   * Send invoice email
   */
  private async sendInvoiceEmail(invoice: any, pdfUrl: string): Promise<void> {
    const emailData = {
      to: invoice.customers.email,
      subject: `Invoice ${invoice.invoice_number} - ${format(new Date(invoice.invoice_date), 'MMM yyyy')}`,
      html: `
        <h2>Invoice ${invoice.invoice_number}</h2>
        <p>Dear ${invoice.customers.first_name} ${invoice.customers.last_name},</p>
        <p>Your water utility invoice for the period ${format(new Date(invoice.period_start), 'MMM dd')} - ${format(new Date(invoice.period_end), 'MMM dd, yyyy')} is ready.</p>
        
        <h3>Invoice Summary</h3>
        <ul>
          <li>Account Number: ${invoice.customers.account_number}</li>
          <li>Invoice Date: ${format(new Date(invoice.invoice_date), 'MMM dd, yyyy')}</li>
          <li>Due Date: ${format(new Date(invoice.due_date), 'MMM dd, yyyy')}</li>
          <li>Total Consumption: ${invoice.consumption} gallons</li>
          <li>Total Amount Due: $${invoice.total_amount.toFixed(2)}</li>
        </ul>
        
        <p>Please pay by the due date to avoid late fees.</p>
        <p><a href="${pdfUrl}">Download Invoice PDF</a></p>
        
        <p>Thank you for your business!</p>
      `,
    };

    // Send email using email service
    await fetch('/api/notifications/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData),
    });
  }

  /**
   * Process payment for invoice
   */
  async processPayment(
    invoiceId: string,
    amount: number,
    paymentMethod: string,
    referenceNumber?: string
  ): Promise<string> {
    try {
      // Get invoice
      const { data: invoice } = await this.supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // Create payment record
      const { data: payment, error } = await this.supabase
        .from('payments')
        .insert({
          tenant_id: invoice.tenant_id,
          customer_id: invoice.customer_id,
          invoice_id: invoiceId,
          payment_date: new Date().toISOString(),
          amount,
          payment_method: paymentMethod,
          reference_number: referenceNumber,
          status: 'completed',
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Create payment allocation
      await this.supabase
        .from('payment_allocations')
        .insert({
          payment_id: payment.id,
          invoice_id: invoiceId,
          amount,
        });

      // Update invoice paid amount and status
      const newPaidAmount = (invoice.paid_amount || 0) + amount;
      const newStatus = newPaidAmount >= invoice.total_amount ? 'paid' : invoice.status;

      await this.supabase
        .from('invoices')
        .update({
          paid_amount: newPaidAmount,
          status: newStatus,
          paid_at: newStatus === 'paid' ? new Date().toISOString() : null,
        })
        .eq('id', invoiceId);

      return payment.id;
    } catch (error) {
      console.error('Payment processing failed:', error);
      throw error;
    }
  }

  /**
   * Get overdue invoices
   */
  async getOverdueInvoices(tenantId: string): Promise<Invoice[]> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select(`
        *,
        customers!inner (
          first_name,
          last_name,
          account_number,
          email
        ),
        invoice_items (*)
      `)
      .eq('tenant_id', tenantId)
      .eq('status', 'sent')
      .lt('due_date', new Date().toISOString())
      .order('due_date', { ascending: true });

    if (error) {
      console.error('Failed to fetch overdue invoices:', error);
      return [];
    }

    // Update status to overdue
    const overdueIds = data?.map(inv => inv.id) || [];
    if (overdueIds.length > 0) {
      await this.supabase
        .from('invoices')
        .update({ status: 'overdue' })
        .in('id', overdueIds);
    }

    return data || [];
  }

  /**
   * Create billing period
   */
  async createBillingPeriod(
    tenantId: string,
    cycleId: string,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    const dueDate = new Date(endDate);
    dueDate.setDate(dueDate.getDate() + 30); // 30 days to pay

    const { data, error } = await this.supabase
      .from('billing_periods')
      .insert({
        tenant_id: tenantId,
        billing_cycle_id: cycleId,
        period_start: startDate.toISOString(),
        period_end: endDate.toISOString(),
        due_date: dueDate.toISOString(),
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data.id;
  }
}

// Export singleton instance
export const billingService = new BillingService();