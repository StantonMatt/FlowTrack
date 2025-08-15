import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvoiceEmailService } from '../invoice-email-service';
import * as mailer from '../mailer';

// Mock dependencies
vi.mock('../mailer');
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/invoices/storage-service');

describe('InvoiceEmailService', () => {
  let service: InvoiceEmailService;
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create mock Supabase client
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };

    service = new InvoiceEmailService(mockSupabase);
  });

  describe('sendInvoiceEmail', () => {
    const mockInvoice = {
      id: 'invoice-123',
      invoice_number: 'INV-2024-001',
      issue_date: '2024-01-15',
      due_date: '2024-02-15',
      total_amount: 1500.00,
      status: 'draft',
      customer: {
        id: 'customer-456',
        full_name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890',
      },
      items: [
        {
          description: 'Water Service',
          quantity: 1,
          unit_price: 1500.00,
          amount: 1500.00,
        },
      ],
    };

    const mockTenant = {
      name: 'Test Water Company',
      settings: {
        logo_url: 'https://example.com/logo.png',
        contact_email: 'billing@testwater.com',
        billing_email: 'noreply@testwater.com',
        contact_phone: '+1234567890',
        primary_color: '#0066cc',
        currency: 'USD',
      },
    };

    it('should send invoice email successfully', async () => {
      // Mock database queries
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockInvoice, error: null }) // Get invoice
        .mockResolvedValueOnce({ data: null, error: null }) // Check existing email
        .mockResolvedValueOnce({ data: mockTenant, error: null }) // Get tenant
        .mockResolvedValueOnce({ data: { id: 'log-123' }, error: null }); // Log email

      // Mock storage service
      const mockStorageService = (service as any).storageService;
      mockStorageService.getSignedUrl = vi.fn().mockResolvedValue({
        url: 'https://signed-url.example.com',
      });

      // Mock email send
      vi.mocked(mailer.sendEmail).mockResolvedValue({
        success: true,
        id: 'msg-123',
      });

      vi.mocked(mailer.renderEmailTemplate).mockResolvedValue('<html>Email</html>');

      const result = await service.sendInvoiceEmail({
        invoiceId: 'invoice-123',
        tenantId: 'tenant-789',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(result.emailLogId).toBe('log-123');

      // Verify email was sent with correct data
      expect(mailer.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'john@example.com',
          subject: 'Invoice INV-2024-001 from Test Water Company',
        })
      );

      // Verify invoice status was updated
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: 'sent',
        sent_at: expect.any(String),
      });
    });

    it('should not send if already sent and resend is false', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockInvoice, error: null })
        .mockResolvedValueOnce({ data: { id: 'existing-email' }, error: null }); // Already sent

      const result = await service.sendInvoiceEmail({
        invoiceId: 'invoice-123',
        tenantId: 'tenant-789',
        resend: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already been sent');
      expect(mailer.sendEmail).not.toHaveBeenCalled();
    });

    it('should allow resending if resend is true', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockInvoice, error: null })
        .mockResolvedValueOnce({ data: mockTenant, error: null })
        .mockResolvedValueOnce({ data: { id: 'log-123' }, error: null });

      vi.mocked(mailer.sendEmail).mockResolvedValue({
        success: true,
        id: 'msg-123',
      });

      vi.mocked(mailer.renderEmailTemplate).mockResolvedValue('<html>Email</html>');

      const result = await service.sendInvoiceEmail({
        invoiceId: 'invoice-123',
        tenantId: 'tenant-789',
        resend: true,
      });

      expect(result.success).toBe(true);
      expect(mailer.sendEmail).toHaveBeenCalled();
    });

    it('should handle attachPdf option', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ 
          data: { ...mockInvoice, pdf_path: 'path/to/invoice.pdf' }, 
          error: null 
        })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: mockTenant, error: null })
        .mockResolvedValueOnce({ data: { id: 'log-123' }, error: null });

      const mockStorageService = (service as any).storageService;
      mockStorageService.downloadInvoicePDF = vi.fn().mockResolvedValue({
        data: new Blob(['PDF content'], { type: 'application/pdf' }),
      });

      vi.mocked(mailer.sendEmail).mockResolvedValue({
        success: true,
        id: 'msg-123',
      });

      vi.mocked(mailer.renderEmailTemplate).mockResolvedValue('<html>Email</html>');

      await service.sendInvoiceEmail({
        invoiceId: 'invoice-123',
        tenantId: 'tenant-789',
        attachPdf: true,
      });

      expect(mailer.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: expect.arrayContaining([
            expect.objectContaining({
              filename: 'invoice-INV-2024-001.pdf',
              contentType: 'application/pdf',
            }),
          ]),
        })
      );
    });

    it('should handle missing recipient email', async () => {
      const invoiceNoEmail = { ...mockInvoice, customer: { ...mockInvoice.customer, email: null } };
      
      mockSupabase.single
        .mockResolvedValueOnce({ data: invoiceNoEmail, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const result = await service.sendInvoiceEmail({
        invoiceId: 'invoice-123',
        tenantId: 'tenant-789',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No recipient email');
    });

    it('should use custom recipients', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockInvoice, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: mockTenant, error: null })
        .mockResolvedValueOnce({ data: { id: 'log-123' }, error: null });

      vi.mocked(mailer.sendEmail).mockResolvedValue({
        success: true,
        id: 'msg-123',
      });

      vi.mocked(mailer.renderEmailTemplate).mockResolvedValue('<html>Email</html>');

      await service.sendInvoiceEmail({
        invoiceId: 'invoice-123',
        tenantId: 'tenant-789',
        to: ['custom1@example.com', 'custom2@example.com'],
        cc: 'cc@example.com',
      });

      expect(mailer.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['custom1@example.com', 'custom2@example.com'],
          cc: 'cc@example.com',
        })
      );
    });

    it('should log failed email attempts', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockInvoice, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: mockTenant, error: null });

      vi.mocked(mailer.sendEmail).mockResolvedValue({
        success: false,
        error: 'Email service error',
      });

      vi.mocked(mailer.renderEmailTemplate).mockResolvedValue('<html>Email</html>');

      const result = await service.sendInvoiceEmail({
        invoiceId: 'invoice-123',
        tenantId: 'tenant-789',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Email service error');

      // Verify failed attempt was logged
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error: 'Email service error',
        })
      );
    });
  });

  describe('getInvoiceEmailHistory', () => {
    it('should retrieve email history', async () => {
      const mockHistory = [
        { id: 'email-1', status: 'sent', sent_at: '2024-01-15' },
        { id: 'email-2', status: 'failed', sent_at: '2024-01-14' },
      ];

      mockSupabase.order.mockResolvedValue({
        data: mockHistory,
        error: null,
      });

      const history = await service.getInvoiceEmailHistory('invoice-123', 'tenant-789');

      expect(history).toEqual(mockHistory);
      expect(mockSupabase.eq).toHaveBeenCalledWith('invoice_id', 'invoice-123');
      expect(mockSupabase.eq).toHaveBeenCalledWith('tenant_id', 'tenant-789');
      expect(mockSupabase.order).toHaveBeenCalledWith('sent_at', { ascending: false });
    });
  });

  describe('isInvoiceSent', () => {
    it('should return true if invoice has been sent', async () => {
      mockSupabase.single.mockResolvedValue({
        data: { id: 'email-123' },
        error: null,
      });

      const isSent = await service.isInvoiceSent('invoice-123', 'tenant-789');

      expect(isSent).toBe(true);
    });

    it('should return false if invoice has not been sent', async () => {
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const isSent = await service.isInvoiceSent('invoice-123', 'tenant-789');

      expect(isSent).toBe(false);
    });
  });

  describe('getLastSentEmail', () => {
    it('should retrieve last sent email', async () => {
      const mockEmail = {
        id: 'email-123',
        message_id: 'msg-123',
        sent_at: '2024-01-15T10:00:00Z',
        status: 'sent',
      };

      mockSupabase.single.mockResolvedValue({
        data: mockEmail,
        error: null,
      });

      const email = await service.getLastSentEmail('invoice-123', 'tenant-789');

      expect(email).toEqual(mockEmail);
      expect(mockSupabase.eq).toHaveBeenCalledWith('status', 'sent');
      expect(mockSupabase.order).toHaveBeenCalledWith('sent_at', { ascending: false });
      expect(mockSupabase.limit).toHaveBeenCalledWith(1);
    });

    it('should return null if no sent emails', async () => {
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const email = await service.getLastSentEmail('invoice-123', 'tenant-789');

      expect(email).toBeNull();
    });
  });

  describe('sendBatchInvoiceEmails', () => {
    it('should send multiple invoice emails', async () => {
      const invoiceIds = ['invoice-1', 'invoice-2', 'invoice-3'];
      
      // Mock sendInvoiceEmail for each invoice
      const sendSpy = vi.spyOn(service, 'sendInvoiceEmail');
      sendSpy
        .mockResolvedValueOnce({ success: true, messageId: 'msg-1' })
        .mockResolvedValueOnce({ success: false, error: 'Failed' })
        .mockResolvedValueOnce({ success: true, messageId: 'msg-3' });

      const results = await service.sendBatchInvoiceEmails(
        invoiceIds,
        'tenant-789',
        { attachPdf: true }
      );

      expect(results.size).toBe(3);
      expect(results.get('invoice-1')?.success).toBe(true);
      expect(results.get('invoice-2')?.success).toBe(false);
      expect(results.get('invoice-3')?.success).toBe(true);

      // Verify each invoice was processed
      expect(sendSpy).toHaveBeenCalledTimes(3);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'invoice-1',
          tenantId: 'tenant-789',
          attachPdf: true,
        })
      );
    });

    it('should respect concurrency limit', async () => {
      const invoiceIds = Array.from({ length: 10 }, (_, i) => `invoice-${i}`);
      
      const sendSpy = vi.spyOn(service, 'sendInvoiceEmail');
      sendSpy.mockResolvedValue({ success: true, messageId: 'msg' });

      await service.sendBatchInvoiceEmails(invoiceIds, 'tenant-789');

      // All invoices should be processed
      expect(sendSpy).toHaveBeenCalledTimes(10);
    });
  });
});