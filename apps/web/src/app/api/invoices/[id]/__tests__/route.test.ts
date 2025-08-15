import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '../route';

// Mock Supabase client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

describe('/api/invoices/[id]', () => {
  let mockSupabase: any;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create mock Supabase client
    mockSupabase = {
      auth: {
        getUser: vi.fn(),
      },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn(),
    };
    
    const { createClient } = vi.mocked(await import('@/lib/supabase/server'));
    createClient.mockResolvedValue(mockSupabase as any);
  });

  describe('GET', () => {
    const mockInvoice = {
      id: 'invoice-123',
      invoice_number: 'INV-2024-001',
      status: 'sent',
      issue_date: '2024-01-15',
      due_date: '2024-02-15',
      billing_period_start: '2024-01-01',
      billing_period_end: '2024-01-31',
      subtotal: 1400.00,
      tax_amount: 100.00,
      tax_rate: 0.07,
      discount_amount: 0,
      total_amount: 1500.00,
      notes: 'Thank you for your business',
      metadata: { custom: 'data' },
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
      sent_at: '2024-01-16T10:00:00Z',
      paid_at: null,
      pdf_path: 'tenants/tenant-789/invoices/INV-2024-001.pdf',
      pdf_generated_at: '2024-01-15T10:30:00Z',
      stripe_invoice_id: null,
      stripe_payment_link: null,
      customer: {
        id: 'customer-456',
        account_number: 'ACC-001',
        full_name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890',
        billing_address: '{"street":"123 Main St","city":"Springfield","state":"IL","zip":"62701"}',
        service_address: null,
        meter_number: 'MTR-001',
        created_at: '2024-01-01T10:00:00Z',
      },
      items: [
        {
          id: 'item-1',
          description: 'Water Service - January 2024',
          quantity: 1,
          unit_price: 1400.00,
          amount: 1400.00,
          metadata: {},
          created_at: '2024-01-15T10:00:00Z',
        },
      ],
      payments: [],
    };

    it('should retrieve invoice details successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: mockInvoice,
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123');
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe('invoice-123');
      expect(data.invoiceNumber).toBe('INV-2024-001');
      expect(data.customer).toBeDefined();
      expect(data.items).toHaveLength(1);
      expect(data.totalPaid).toBe(0);
      expect(data.balanceDue).toBe(1500.00);
      expect(data.hasPdf).toBe(true);
      expect(data.actions.viewPdf).toBe('/api/invoices/invoice-123/pdf');
    });

    it('should return 401 if not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123');
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 404 if invoice not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-999');
      const response = await GET(request, { params: { id: 'invoice-999' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Invoice not found');
    });

    it('should calculate overdue status correctly', async () => {
      const overdueInvoice = {
        ...mockInvoice,
        due_date: '2023-01-01', // Past date
        status: 'sent',
      };

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: overdueInvoice,
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123');
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isOverdue).toBe(true);
    });

    it('should calculate paid amount correctly', async () => {
      const invoiceWithPayments = {
        ...mockInvoice,
        payments: [
          { id: 'pay-1', amount: 500, status: 'completed' },
          { id: 'pay-2', amount: 300, status: 'completed' },
          { id: 'pay-3', amount: 100, status: 'pending' }, // Should not count
        ],
      };

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: invoiceWithPayments,
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123');
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.totalPaid).toBe(800);
      expect(data.balanceDue).toBe(700); // 1500 - 800
    });
  });

  describe('PATCH', () => {
    it('should update invoice successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: 'invoice-123', status: 'sent' },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { id: 'invoice-123', status: 'paid' },
          error: null,
        });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'paid' }),
      });

      const response = await PATCH(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Invoice updated successfully');
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'paid',
          paid_at: expect.any(String),
        })
      );
    });

    it('should prevent updating cancelled invoices', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: { id: 'invoice-123', status: 'cancelled' },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123', {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'Updated notes' }),
      });

      const response = await PATCH(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Cannot update cancelled invoice');
    });

    it('should prevent updating paid invoices except to cancel', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: { id: 'invoice-123', status: 'paid' },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123', {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'Updated notes' }),
      });

      const response = await PATCH(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Cannot update paid invoice');
    });

    it('should allow cancelling paid invoices', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: 'invoice-123', status: 'paid' },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { id: 'invoice-123', status: 'cancelled' },
          error: null,
        });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });

      const response = await PATCH(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Invoice updated successfully');
    });
  });

  describe('DELETE', () => {
    it('should delete draft invoice successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: { id: 'invoice-123', status: 'draft', invoice_number: 'INV-2024-001' },
        error: null,
      });

      mockSupabase.delete.mockResolvedValue({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Invoice deleted successfully');
      expect(data.invoiceNumber).toBe('INV-2024-001');
    });

    it('should prevent deleting non-draft invoices', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: { id: 'invoice-123', status: 'sent', invoice_number: 'INV-2024-001' },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Only draft invoices can be deleted');
      expect(data.suggestion).toContain('PATCH');
    });

    it('should return 404 if invoice not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-999', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: { id: 'invoice-999' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Invoice not found');
    });
  });
});