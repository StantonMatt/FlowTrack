import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoiceStorageService } from '../storage-service';

// Mock Supabase client
const mockStorage = {
  listBuckets: vi.fn(),
  createBucket: vi.fn(),
  from: vi.fn(),
};

const mockSupabase = {
  storage: mockStorage,
} as any;

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

describe('InvoiceStorageService', () => {
  let service: InvoiceStorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InvoiceStorageService(mockSupabase);
  });

  describe('ensureBucket', () => {
    it('should create bucket if it does not exist', async () => {
      mockStorage.listBuckets.mockResolvedValue({ 
        data: [], 
        error: null 
      });
      mockStorage.createBucket.mockResolvedValue({ 
        data: null, 
        error: null 
      });

      await service.ensureBucket();

      expect(mockStorage.listBuckets).toHaveBeenCalled();
      expect(mockStorage.createBucket).toHaveBeenCalledWith('invoices', {
        public: false,
        fileSizeLimit: 10485760,
        allowedMimeTypes: ['application/pdf'],
      });
    });

    it('should not create bucket if it already exists', async () => {
      mockStorage.listBuckets.mockResolvedValue({ 
        data: [{ name: 'invoices' }], 
        error: null 
      });

      await service.ensureBucket();

      expect(mockStorage.listBuckets).toHaveBeenCalled();
      expect(mockStorage.createBucket).not.toHaveBeenCalled();
    });

    it('should handle bucket creation errors gracefully', async () => {
      mockStorage.listBuckets.mockResolvedValue({ 
        data: [], 
        error: null 
      });
      mockStorage.createBucket.mockResolvedValue({ 
        data: null, 
        error: new Error('Bucket already exists') 
      });

      // Should not throw
      await expect(service.ensureBucket()).resolves.toBeUndefined();
    });
  });

  describe('getInvoicePath', () => {
    it('should generate correct path structure', () => {
      const path = service.getInvoicePath('tenant-123', 'INV-2024-001');
      expect(path).toBe('tenants/tenant-123/invoices/INV-2024-001.pdf');
    });

    it('should sanitize invoice numbers', () => {
      const path = service.getInvoicePath('tenant-123', 'INV/2024#001');
      expect(path).toBe('tenants/tenant-123/invoices/INV_2024_001.pdf');
    });

    it('should handle special characters in invoice number', () => {
      const path = service.getInvoicePath('tenant-123', 'INV@2024!001$test');
      expect(path).toBe('tenants/tenant-123/invoices/INV_2024_001_test.pdf');
    });
  });

  describe('uploadInvoicePDF', () => {
    it('should upload PDF successfully', async () => {
      const mockUpload = vi.fn().mockResolvedValue({ 
        data: null, 
        error: null 
      });
      mockStorage.from.mockReturnValue({
        upload: mockUpload,
      });
      mockStorage.listBuckets.mockResolvedValue({ 
        data: [{ name: 'invoices' }], 
        error: null 
      });

      const buffer = new Uint8Array([1, 2, 3]);
      const result = await service.uploadInvoicePDF('tenant-123', 'INV-001', buffer);

      expect(result.path).toBe('tenants/tenant-123/invoices/INV-001.pdf');
      expect(result.error).toBeUndefined();
      expect(mockUpload).toHaveBeenCalledWith(
        'tenants/tenant-123/invoices/INV-001.pdf',
        buffer,
        expect.objectContaining({
          contentType: 'application/pdf',
          cacheControl: '3600',
          upsert: true,
        })
      );
    });

    it('should handle upload errors', async () => {
      const mockUpload = vi.fn().mockResolvedValue({ 
        data: null, 
        error: new Error('Upload failed') 
      });
      mockStorage.from.mockReturnValue({
        upload: mockUpload,
      });
      mockStorage.listBuckets.mockResolvedValue({ 
        data: [{ name: 'invoices' }], 
        error: null 
      });

      const buffer = new Uint8Array([1, 2, 3]);
      const result = await service.uploadInvoicePDF('tenant-123', 'INV-001', buffer);

      expect(result.path).toBe('');
      expect(result.error).toBe('Upload failed');
    });

    it('should use custom options when provided', async () => {
      const mockUpload = vi.fn().mockResolvedValue({ 
        data: null, 
        error: null 
      });
      mockStorage.from.mockReturnValue({
        upload: mockUpload,
      });
      mockStorage.listBuckets.mockResolvedValue({ 
        data: [{ name: 'invoices' }], 
        error: null 
      });

      const buffer = new Uint8Array([1, 2, 3]);
      const result = await service.uploadInvoicePDF('tenant-123', 'INV-001', buffer, {
        upsert: false,
        cacheControl: '7200',
      });

      expect(mockUpload).toHaveBeenCalledWith(
        'tenants/tenant-123/invoices/INV-001.pdf',
        buffer,
        expect.objectContaining({
          contentType: 'application/pdf',
          cacheControl: '7200',
          upsert: false,
        })
      );
    });
  });

  describe('getSignedUrl', () => {
    it('should generate signed URL successfully', async () => {
      const mockCreateSignedUrl = vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://example.com/signed-url' },
        error: null,
      });
      mockStorage.from.mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      });

      const result = await service.getSignedUrl('path/to/file.pdf');

      expect(result.url).toBe('https://example.com/signed-url');
      expect(result.error).toBeUndefined();
      expect(mockCreateSignedUrl).toHaveBeenCalledWith('path/to/file.pdf', 3600);
    });

    it('should handle signed URL errors', async () => {
      const mockCreateSignedUrl = vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Failed to create URL'),
      });
      mockStorage.from.mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      });

      const result = await service.getSignedUrl('path/to/file.pdf');

      expect(result.url).toBeUndefined();
      expect(result.error).toBe('Failed to create URL');
    });

    it('should use custom expiry time', async () => {
      const mockCreateSignedUrl = vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://example.com/signed-url' },
        error: null,
      });
      mockStorage.from.mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      });

      await service.getSignedUrl('path/to/file.pdf', 7200);

      expect(mockCreateSignedUrl).toHaveBeenCalledWith('path/to/file.pdf', 7200);
    });
  });

  describe('getInvoiceSignedUrl', () => {
    it('should generate signed URL for invoice', async () => {
      const mockCreateSignedUrl = vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://example.com/signed-url' },
        error: null,
      });
      mockStorage.from.mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      });

      const result = await service.getInvoiceSignedUrl('tenant-123', 'INV-001');

      expect(result.url).toBe('https://example.com/signed-url');
      expect(mockCreateSignedUrl).toHaveBeenCalledWith(
        'tenants/tenant-123/invoices/INV-001.pdf',
        3600
      );
    });
  });

  describe('downloadInvoicePDF', () => {
    it('should download PDF successfully', async () => {
      const mockBlob = new Blob(['pdf content'], { type: 'application/pdf' });
      const mockDownload = vi.fn().mockResolvedValue({
        data: mockBlob,
        error: null,
      });
      mockStorage.from.mockReturnValue({
        download: mockDownload,
      });

      const result = await service.downloadInvoicePDF('path/to/file.pdf');

      expect(result.data).toBe(mockBlob);
      expect(result.error).toBeUndefined();
    });

    it('should handle download errors', async () => {
      const mockDownload = vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Download failed'),
      });
      mockStorage.from.mockReturnValue({
        download: mockDownload,
      });

      const result = await service.downloadInvoicePDF('path/to/file.pdf');

      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Download failed');
    });
  });

  describe('deleteInvoicePDF', () => {
    it('should delete PDF successfully', async () => {
      const mockRemove = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      mockStorage.from.mockReturnValue({
        remove: mockRemove,
      });

      const result = await service.deleteInvoicePDF('path/to/file.pdf');

      expect(result.error).toBeUndefined();
      expect(mockRemove).toHaveBeenCalledWith(['path/to/file.pdf']);
    });

    it('should handle deletion errors', async () => {
      const mockRemove = vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Delete failed'),
      });
      mockStorage.from.mockReturnValue({
        remove: mockRemove,
      });

      const result = await service.deleteInvoicePDF('path/to/file.pdf');

      expect(result.error).toBe('Delete failed');
    });
  });

  describe('listTenantInvoices', () => {
    it('should list invoices for tenant', async () => {
      const mockFiles = [
        { name: 'INV-001.pdf', created_at: '2024-01-01' },
        { name: 'INV-002.pdf', created_at: '2024-01-02' },
      ];
      const mockList = vi.fn().mockResolvedValue({
        data: mockFiles,
        error: null,
      });
      mockStorage.from.mockReturnValue({
        list: mockList,
      });

      const result = await service.listTenantInvoices('tenant-123');

      expect(result.files).toEqual(mockFiles);
      expect(result.error).toBeUndefined();
      expect(mockList).toHaveBeenCalledWith('tenants/tenant-123/invoices', {
        limit: 100,
        offset: 0,
        sortBy: {
          column: 'created_at',
          order: 'desc',
        },
      });
    });

    it('should use custom options', async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      });
      mockStorage.from.mockReturnValue({
        list: mockList,
      });

      await service.listTenantInvoices('tenant-123', {
        limit: 50,
        offset: 10,
        sortBy: 'name',
      });

      expect(mockList).toHaveBeenCalledWith('tenants/tenant-123/invoices', {
        limit: 50,
        offset: 10,
        sortBy: {
          column: 'name',
          order: 'desc',
        },
      });
    });
  });

  describe('invoiceExists', () => {
    it('should return true if invoice exists', async () => {
      const mockDownload = vi.fn().mockResolvedValue({
        data: new Blob(['content']),
        error: null,
      });
      mockStorage.from.mockReturnValue({
        download: mockDownload,
      });

      const exists = await service.invoiceExists('tenant-123', 'INV-001');

      expect(exists).toBe(true);
    });

    it('should return false if invoice does not exist', async () => {
      const mockDownload = vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Not found'),
      });
      mockStorage.from.mockReturnValue({
        download: mockDownload,
      });

      const exists = await service.invoiceExists('tenant-123', 'INV-001');

      expect(exists).toBe(false);
    });
  });

  describe('copyInvoice', () => {
    it('should copy invoice successfully', async () => {
      const mockBlob = new Blob(['pdf content']);
      const mockDownload = vi.fn().mockResolvedValue({
        data: mockBlob,
        error: null,
      });
      const mockUpload = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      mockStorage.from.mockReturnValue({
        download: mockDownload,
        upload: mockUpload,
      });

      const result = await service.copyInvoice('source/path.pdf', 'dest/path.pdf');

      expect(result.error).toBeUndefined();
      expect(mockDownload).toHaveBeenCalledWith('source/path.pdf');
      expect(mockUpload).toHaveBeenCalledWith('dest/path.pdf', mockBlob, {
        contentType: 'application/pdf',
      });
    });

    it('should handle copy errors', async () => {
      const mockDownload = vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Download failed'),
      });
      mockStorage.from.mockReturnValue({
        download: mockDownload,
      });

      const result = await service.copyInvoice('source/path.pdf', 'dest/path.pdf');

      expect(result.error).toBe('Download failed');
    });
  });

  describe('moveInvoice', () => {
    it('should move invoice successfully', async () => {
      const mockBlob = new Blob(['pdf content']);
      const mockDownload = vi.fn().mockResolvedValue({
        data: mockBlob,
        error: null,
      });
      const mockUpload = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      const mockRemove = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      mockStorage.from.mockReturnValue({
        download: mockDownload,
        upload: mockUpload,
        remove: mockRemove,
      });

      const result = await service.moveInvoice('source/path.pdf', 'dest/path.pdf');

      expect(result.error).toBeUndefined();
      expect(mockDownload).toHaveBeenCalledWith('source/path.pdf');
      expect(mockUpload).toHaveBeenCalledWith('dest/path.pdf', mockBlob, {
        contentType: 'application/pdf',
      });
      expect(mockRemove).toHaveBeenCalledWith(['source/path.pdf']);
    });

    it('should rollback copy if delete fails', async () => {
      const mockBlob = new Blob(['pdf content']);
      const mockDownload = vi.fn().mockResolvedValue({
        data: mockBlob,
        error: null,
      });
      const mockUpload = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      const mockRemove = vi.fn()
        .mockResolvedValueOnce({
          data: null,
          error: new Error('Delete failed'),
        })
        .mockResolvedValueOnce({
          data: null,
          error: null,
        });
      mockStorage.from.mockReturnValue({
        download: mockDownload,
        upload: mockUpload,
        remove: mockRemove,
      });

      const result = await service.moveInvoice('source/path.pdf', 'dest/path.pdf');

      expect(result.error).toBe('Delete failed');
      expect(mockRemove).toHaveBeenCalledTimes(2);
      expect(mockRemove).toHaveBeenNthCalledWith(1, ['source/path.pdf']);
      expect(mockRemove).toHaveBeenNthCalledWith(2, ['dest/path.pdf']); // Cleanup
    });
  });
});