import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '../route';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/invoices/pdf-generator', () => ({
  generateInvoicePDF: vi.fn(),
}));

vi.mock('@/lib/invoices/storage-service', () => ({
  InvoiceStorageService: vi.fn(),
}));

describe('/api/invoices/[id]/pdf', () => {
  let mockSupabase: any;
  let mockStorageService: any;
  
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
    };
    
    // Create mock storage service
    mockStorageService = {
      uploadInvoicePDF: vi.fn(),
      getSignedUrl: vi.fn(),
      deleteInvoicePDF: vi.fn(),
      downloadInvoicePDF: vi.fn(),
    };
    
    const { createClient } = vi.mocked(await import('@/lib/supabase/server'));
    createClient.mockResolvedValue(mockSupabase as any);
    
    const { InvoiceStorageService } = vi.mocked(await import('@/lib/invoices/storage-service'));
    InvoiceStorageService.mockImplementation(() => mockStorageService);
  });

  describe('GET', () => {
    it('should return signed URL for existing PDF', async () => {
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
        data: {
          invoice_number: 'INV-2024-001',
          pdf_path: 'tenants/tenant-789/invoices/INV-2024-001.pdf',
          pdf_generated_at: '2024-01-15T10:00:00Z',
        },
        error: null,
      });

      mockStorageService.getSignedUrl.mockResolvedValue({
        url: 'https://signed-url.example.com/pdf',
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123/pdf');
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.url).toBe('https://signed-url.example.com/pdf');
      expect(data.filename).toBe('invoice-INV-2024-001.pdf');
      expect(data.wasGenerated).toBe(false);
      expect(mockStorageService.getSignedUrl).toHaveBeenCalledWith(
        'tenants/tenant-789/invoices/INV-2024-001.pdf',
        3600
      );
    });

    it('should generate PDF if it does not exist', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { 
          user: { 
            id: 'user-123',
            user_metadata: { tenant_id: 'tenant-789' },
          },
        },
        error: null,
      });

      // First call for GET - no PDF exists
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          invoice_number: 'INV-2024-001',
          pdf_path: null,
          pdf_generated_at: null,
        },
        error: null,
      });

      // Mock the POST function behavior (simplified)
      vi.mocked(await import('@/lib/invoices/pdf-generator')).generateInvoicePDF.mockResolvedValue(
        new Uint8Array([1, 2, 3])
      );

      // For the POST call within GET
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'invoice-123',
          invoice_number: 'INV-2024-001',
          customer: { full_name: 'John Doe' },
          items: [],
          total_amount: 1500,
        },
        error: null,
      });

      // Tenant data for POST
      mockSupabase.single.mockResolvedValueOnce({
        data: { name: 'Test Company', settings: {} },
        error: null,
      });

      mockStorageService.uploadInvoicePDF.mockResolvedValue({
        path: 'tenants/tenant-789/invoices/INV-2024-001.pdf',
        error: null,
      });

      mockStorageService.getSignedUrl.mockResolvedValue({
        url: 'https://signed-url.example.com/pdf',
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123/pdf');
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.url).toBe('https://signed-url.example.com/pdf');
      expect(data.wasGenerated).toBe(true);
    });

    it('should handle redirect parameter', async () => {
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
        data: {
          invoice_number: 'INV-2024-001',
          pdf_path: 'tenants/tenant-789/invoices/INV-2024-001.pdf',
        },
        error: null,
      });

      mockStorageService.getSignedUrl.mockResolvedValue({
        url: 'https://signed-url.example.com/pdf',
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123/pdf?redirect=true');
      const response = await GET(request, { params: { id: 'invoice-123' } });

      expect(response.status).toBe(307); // Redirect status
      expect(response.headers.get('location')).toBe('https://signed-url.example.com/pdf');
    });

    it('should handle download parameter', async () => {
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
        data: {
          invoice_number: 'INV-2024-001',
          pdf_path: 'tenants/tenant-789/invoices/INV-2024-001.pdf',
        },
        error: null,
      });

      mockStorageService.getSignedUrl.mockResolvedValue({
        url: 'https://signed-url.example.com/pdf',
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123/pdf?download=true');
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain('attachment');
      expect(response.headers.get('content-disposition')).toContain('invoice-INV-2024-001.pdf');
      expect(data.url).toBe('https://signed-url.example.com/pdf');
    });

    it('should respect custom expiration time', async () => {
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
        data: {
          invoice_number: 'INV-2024-001',
          pdf_path: 'tenants/tenant-789/invoices/INV-2024-001.pdf',
        },
        error: null,
      });

      mockStorageService.getSignedUrl.mockResolvedValue({
        url: 'https://signed-url.example.com/pdf',
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123/pdf?expiresIn=7200');
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockStorageService.getSignedUrl).toHaveBeenCalledWith(
        'tenants/tenant-789/invoices/INV-2024-001.pdf',
        7200
      );
      expect(data.expiresIn).toBe(7200);
    });

    it('should cap expiration time to 7 days', async () => {
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
        data: {
          invoice_number: 'INV-2024-001',
          pdf_path: 'tenants/tenant-789/invoices/INV-2024-001.pdf',
        },
        error: null,
      });

      mockStorageService.getSignedUrl.mockResolvedValue({
        url: 'https://signed-url.example.com/pdf',
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123/pdf?expiresIn=864000'); // 10 days
      const response = await GET(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockStorageService.getSignedUrl).toHaveBeenCalledWith(
        'tenants/tenant-789/invoices/INV-2024-001.pdf',
        604800 // 7 days in seconds
      );
      expect(data.expiresIn).toBe(604800);
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

      const request = new NextRequest('http://localhost/api/invoices/invoice-999/pdf');
      const response = await GET(request, { params: { id: 'invoice-999' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Invoice not found');
    });
  });

  describe('DELETE', () => {
    it('should delete PDF successfully', async () => {
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
        data: {
          pdf_path: 'tenants/tenant-789/invoices/INV-2024-001.pdf',
        },
        error: null,
      });

      mockStorageService.deleteInvoicePDF.mockResolvedValue({
        error: null,
      });

      mockSupabase.update.mockResolvedValue({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123/pdf', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Invoice PDF deleted successfully');
      expect(mockStorageService.deleteInvoicePDF).toHaveBeenCalledWith(
        'tenants/tenant-789/invoices/INV-2024-001.pdf'
      );
      expect(mockSupabase.update).toHaveBeenCalledWith({
        pdf_path: null,
        pdf_generated_at: null,
      });
    });

    it('should return 404 if no PDF exists', async () => {
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
        data: {
          pdf_path: null,
        },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/invoices/invoice-123/pdf', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: { id: 'invoice-123' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No PDF found for this invoice');
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

      const request = new NextRequest('http://localhost/api/invoices/invoice-999/pdf', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: { id: 'invoice-999' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Invoice not found');
    });
  });
});