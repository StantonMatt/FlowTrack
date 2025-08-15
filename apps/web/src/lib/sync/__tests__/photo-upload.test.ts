import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { photoUploadService } from '../photo-upload';
import { createClient } from '@/lib/supabase/client';

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

describe('PhotoUploadService', () => {
  let mockSupabaseClient: any;

  beforeEach(() => {
    // Setup mock Supabase client
    mockSupabaseClient = {
      storage: {
        from: vi.fn().mockReturnThis(),
        list: vi.fn(),
        upload: vi.fn(),
        getPublicUrl: vi.fn(),
        createSignedUrl: vi.fn(),
        remove: vi.fn(),
      },
    };

    vi.mocked(createClient).mockReturnValue(mockSupabaseClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadPhoto', () => {
    const mockBlob = new Blob(['test photo data'], { type: 'image/jpeg' });
    const uploadOptions = {
      tenantId: 'tenant-123',
      customerId: 'customer-456',
      readingId: 'reading-789',
      idempotencyKey: 'idem-key-abc',
    };

    it('should successfully upload a photo', async () => {
      // Mock no existing file
      mockSupabaseClient.storage.list.mockResolvedValue({
        data: [],
        error: null,
      });

      // Mock successful upload
      mockSupabaseClient.storage.upload.mockResolvedValue({
        data: { path: 'tenant-123/customers/customer-456/readings/reading-789/photo.jpg' },
        error: null,
      });

      // Mock public URL
      mockSupabaseClient.storage.getPublicUrl.mockReturnValue({
        data: { publicUrl: 'https://storage.example.com/photo.jpg' },
      });

      const result = await photoUploadService.uploadPhoto(mockBlob, uploadOptions);

      expect(result).toEqual({
        success: true,
        url: 'https://storage.example.com/photo.jpg',
        path: 'tenant-123/customers/customer-456/readings/reading-789/photo.jpg',
      });

      // Verify upload was called with correct parameters
      expect(mockSupabaseClient.storage.upload).toHaveBeenCalledWith(
        expect.stringContaining('tenant-123/customers/customer-456/readings'),
        mockBlob,
        expect.objectContaining({
          contentType: 'image/jpeg',
          upsert: false,
          cacheControl: '3600',
        })
      );
    });

    it('should handle duplicate file (idempotency)', async () => {
      // Mock existing file
      mockSupabaseClient.storage.list.mockResolvedValue({
        data: [{ name: 'existing-photo.jpg' }],
        error: null,
      });

      // Mock public URL for existing file
      mockSupabaseClient.storage.getPublicUrl.mockReturnValue({
        data: { publicUrl: 'https://storage.example.com/existing-photo.jpg' },
      });

      const result = await photoUploadService.uploadPhoto(mockBlob, uploadOptions);

      expect(result).toEqual({
        success: true,
        url: 'https://storage.example.com/existing-photo.jpg',
        path: expect.any(String),
      });

      // Verify upload was not called
      expect(mockSupabaseClient.storage.upload).not.toHaveBeenCalled();
    });

    it('should reject oversized photos', async () => {
      // Create blob larger than 5MB
      const largeBlob = new Blob([new ArrayBuffer(6 * 1024 * 1024)], { type: 'image/jpeg' });

      const result = await photoUploadService.uploadPhoto(largeBlob, uploadOptions);

      expect(result).toEqual({
        success: false,
        error: 'Photo size exceeds 5MB limit',
      });

      // Verify upload was not attempted
      expect(mockSupabaseClient.storage.upload).not.toHaveBeenCalled();
    });

    it('should handle empty blob', async () => {
      const emptyBlob = new Blob([], { type: 'image/jpeg' });

      const result = await photoUploadService.uploadPhoto(emptyBlob, uploadOptions);

      expect(result).toEqual({
        success: false,
        error: 'Invalid or empty blob',
      });
    });

    it('should handle upload errors', async () => {
      // Mock no existing file
      mockSupabaseClient.storage.list.mockResolvedValue({
        data: [],
        error: null,
      });

      // Mock upload error
      mockSupabaseClient.storage.upload.mockResolvedValue({
        data: null,
        error: { message: 'Storage error' },
      });

      const result = await photoUploadService.uploadPhoto(mockBlob, uploadOptions);

      expect(result).toEqual({
        success: false,
        error: 'Storage error',
      });
    });

    it('should handle duplicate file error during upload', async () => {
      // Mock no existing file in list
      mockSupabaseClient.storage.list.mockResolvedValue({
        data: [],
        error: null,
      });

      // Mock duplicate error during upload
      mockSupabaseClient.storage.upload.mockResolvedValue({
        data: null,
        error: { message: 'The resource already exists (duplicate)' },
      });

      // Mock public URL
      mockSupabaseClient.storage.getPublicUrl.mockReturnValue({
        data: { publicUrl: 'https://storage.example.com/photo.jpg' },
      });

      const result = await photoUploadService.uploadPhoto(mockBlob, uploadOptions);

      expect(result).toEqual({
        success: true,
        url: 'https://storage.example.com/photo.jpg',
        path: expect.any(String),
      });
    });
  });

  describe('validatePhoto', () => {
    it('should validate valid photo', () => {
      const validBlob = new Blob(['data'], { type: 'image/jpeg' });
      const result = photoUploadService.validatePhoto(validBlob);

      expect(result).toEqual({
        valid: true,
      });
    });

    it('should reject oversized photo', () => {
      const largeBlob = new Blob([new ArrayBuffer(6 * 1024 * 1024)], { type: 'image/jpeg' });
      const result = photoUploadService.validatePhoto(largeBlob);

      expect(result).toEqual({
        valid: false,
        error: 'Photo exceeds 5MB size limit',
      });
    });

    it('should reject invalid mime type', () => {
      const invalidBlob = new Blob(['data'], { type: 'image/gif' });
      const result = photoUploadService.validatePhoto(invalidBlob);

      expect(result).toEqual({
        valid: false,
        error: 'Invalid photo type: image/gif. Supported: JPEG, PNG, WebP',
      });
    });
  });

  describe('getSignedUrl', () => {
    it('should generate signed URL', async () => {
      mockSupabaseClient.storage.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://storage.example.com/signed-url' },
        error: null,
      });

      const result = await photoUploadService.getSignedUrl('path/to/photo.jpg');

      expect(result).toEqual({
        url: 'https://storage.example.com/signed-url',
      });

      expect(mockSupabaseClient.storage.createSignedUrl).toHaveBeenCalledWith(
        'path/to/photo.jpg',
        3600
      );
    });

    it('should handle signed URL errors', async () => {
      mockSupabaseClient.storage.createSignedUrl.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await photoUploadService.getSignedUrl('invalid/path.jpg');

      expect(result).toEqual({
        error: 'Not found',
      });
    });
  });

  describe('deletePhoto', () => {
    it('should delete photo successfully', async () => {
      mockSupabaseClient.storage.remove.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await photoUploadService.deletePhoto('path/to/photo.jpg');

      expect(result).toBe(true);
      expect(mockSupabaseClient.storage.remove).toHaveBeenCalledWith(['path/to/photo.jpg']);
    });

    it('should handle delete errors', async () => {
      mockSupabaseClient.storage.remove.mockResolvedValue({
        data: null,
        error: { message: 'Delete failed' },
      });

      const result = await photoUploadService.deletePhoto('path/to/photo.jpg');

      expect(result).toBe(false);
    });
  });

  describe('uploadBatch', () => {
    it('should upload multiple photos with concurrency limit', async () => {
      const photos = Array.from({ length: 10 }, (_, i) => ({
        blob: new Blob([`photo ${i}`], { type: 'image/jpeg' }),
        options: {
          tenantId: 'tenant-123',
          customerId: `customer-${i}`,
          idempotencyKey: `key-${i}`,
        },
      }));

      // Mock successful uploads
      mockSupabaseClient.storage.list.mockResolvedValue({
        data: [],
        error: null,
      });

      mockSupabaseClient.storage.upload.mockResolvedValue({
        data: { path: 'test/path.jpg' },
        error: null,
      });

      mockSupabaseClient.storage.getPublicUrl.mockReturnValue({
        data: { publicUrl: 'https://storage.example.com/photo.jpg' },
      });

      const results = await photoUploadService.uploadBatch(photos);

      expect(results).toHaveLength(10);
      expect(results.every(r => r.success)).toBe(true);

      // Verify uploads were batched (concurrency limit is 3)
      // With 10 photos and limit of 3, we expect 4 batches
      // But since they run in parallel within batches, we can't easily test the exact batching
      expect(mockSupabaseClient.storage.upload).toHaveBeenCalledTimes(10);
    });

    it('should handle mixed success and failure in batch', async () => {
      const photos = [
        {
          blob: new Blob(['photo 1'], { type: 'image/jpeg' }),
          options: { tenantId: 'tenant-123', customerId: 'customer-1', idempotencyKey: 'key-1' },
        },
        {
          blob: new Blob([new ArrayBuffer(6 * 1024 * 1024)], { type: 'image/jpeg' }), // Too large
          options: { tenantId: 'tenant-123', customerId: 'customer-2', idempotencyKey: 'key-2' },
        },
      ];

      // Mock successful upload for first photo
      mockSupabaseClient.storage.list.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      mockSupabaseClient.storage.upload.mockResolvedValueOnce({
        data: { path: 'test/path.jpg' },
        error: null,
      });

      mockSupabaseClient.storage.getPublicUrl.mockReturnValue({
        data: { publicUrl: 'https://storage.example.com/photo.jpg' },
      });

      const results = await photoUploadService.uploadBatch(photos);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toContain('5MB');
    });
  });

  describe('compressPhoto', () => {
    // Note: Canvas-based compression is difficult to test in Node environment
    // These tests would need a DOM environment or mocking of Image and Canvas APIs
    
    it('should return original blob if already under size limit', async () => {
      const smallBlob = new Blob(['small data'], { type: 'image/jpeg' });
      const result = await photoUploadService.compressPhoto(smallBlob);
      
      expect(result).toBe(smallBlob);
    });

    // Additional compression tests would require DOM environment setup
  });
});