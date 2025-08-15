import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { photoService } from './photo-service';
import { db } from '@/lib/db/offline';

// Mock canvas
const mockToBlob = vi.fn();
const mockGetContext = vi.fn(() => ({
  drawImage: vi.fn(),
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high',
}));

global.HTMLCanvasElement.prototype.toBlob = mockToBlob;
global.HTMLCanvasElement.prototype.getContext = mockGetContext as any;

// Mock Image
class MockImage {
  width = 1920;
  height = 1080;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';

  constructor() {
    setTimeout(() => {
      if (this.onload) this.onload();
    }, 0);
  }
}

global.Image = MockImage as any;

// Mock URL
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
global.URL.createObjectURL = mockCreateObjectURL;
global.URL.revokeObjectURL = mockRevokeObjectURL;

// Mock crypto
global.crypto.randomUUID = vi.fn(() => 'test-uuid-123');

describe('PhotoService', () => {
  beforeEach(async () => {
    await db.open();
    vi.clearAllMocks();
    
    // Setup default mock for canvas.toBlob
    mockToBlob.mockImplementation((callback, type, quality) => {
      const blob = new Blob(['mock image data'], { type: 'image/jpeg' });
      callback(blob);
    });
  });

  afterEach(async () => {
    await db.photos.clear();
    photoService.revokeAllObjectUrls();
  });

  describe('processImage', () => {
    it('should process and compress an image', async () => {
      const file = new File(['image data'], 'test.jpg', { type: 'image/jpeg' });
      
      const result = await photoService.processImage(file);
      
      expect(result).toMatchObject({
        id: 'test-uuid-123',
        width: 1920,
        height: 1080,
        blob: expect.any(Blob),
      });
      
      // Verify saved to DB
      const saved = await db.getPhoto(result.id);
      expect(saved).toBeDefined();
    });

    it('should reject non-image files', async () => {
      const file = new File(['text data'], 'test.txt', { type: 'text/plain' });
      
      await expect(photoService.processImage(file)).rejects.toThrow(
        'Invalid file type'
      );
    });

    it('should reject files that are too large', async () => {
      const largeData = new Uint8Array(20 * 1024 * 1024); // 20MB
      const file = new File([largeData], 'large.jpg', { type: 'image/jpeg' });
      
      await expect(photoService.processImage(file)).rejects.toThrow(
        'File too large'
      );
    });

    it('should resize images to fit max dimensions', async () => {
      // Mock a large image
      (MockImage as any).prototype.width = 4000;
      (MockImage as any).prototype.height = 3000;
      
      const file = new File(['image data'], 'test.jpg', { type: 'image/jpeg' });
      
      const result = await photoService.processImage(file, {
        maxWidth: 1920,
        maxHeight: 1080,
      });
      
      // Should maintain aspect ratio
      expect(result.width).toBe(1440); // 1080 * (4000/3000)
      expect(result.height).toBe(1080);
    });

    it('should progressively reduce quality for large files', async () => {
      let callCount = 0;
      mockToBlob.mockImplementation((callback, type, quality) => {
        callCount++;
        // Return large blob first, then smaller
        const size = callCount === 1 ? 10 * 1024 * 1024 : 3 * 1024 * 1024;
        const blob = new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
        callback(blob);
      });
      
      const file = new File(['image data'], 'test.jpg', { type: 'image/jpeg' });
      
      await photoService.processImage(file);
      
      // Should have tried multiple quality levels
      expect(mockToBlob).toHaveBeenCalledTimes(2);
    });
  });

  describe('object URL management', () => {
    it('should create and cache object URLs', () => {
      const blob = new Blob(['image data'], { type: 'image/jpeg' });
      
      const url1 = photoService.getObjectUrl('photo-1', blob);
      expect(url1).toBe('blob:mock-url');
      expect(mockCreateObjectURL).toHaveBeenCalledWith(blob);
      
      // Should return cached URL
      mockCreateObjectURL.mockClear();
      const url2 = photoService.getObjectUrl('photo-1');
      expect(url2).toBe('blob:mock-url');
      expect(mockCreateObjectURL).not.toHaveBeenCalled();
    });

    it('should revoke object URLs', () => {
      const blob = new Blob(['image data'], { type: 'image/jpeg' });
      photoService.getObjectUrl('photo-1', blob);
      
      photoService.revokeObjectUrl('photo-1');
      
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
      
      // Should return null after revoke
      const url = photoService.getObjectUrl('photo-1');
      expect(url).toBeNull();
    });

    it('should revoke all object URLs', () => {
      const blob1 = new Blob(['image1'], { type: 'image/jpeg' });
      const blob2 = new Blob(['image2'], { type: 'image/jpeg' });
      
      photoService.getObjectUrl('photo-1', blob1);
      photoService.getObjectUrl('photo-2', blob2);
      
      photoService.revokeAllObjectUrls();
      
      expect(mockRevokeObjectURL).toHaveBeenCalledTimes(2);
    });
  });

  describe('photo storage', () => {
    it('should load photo from storage', async () => {
      const blob = new Blob(['image data'], { type: 'image/jpeg' });
      await db.savePhoto(blob, 'test-photo-id');
      
      const photo = await photoService.loadPhoto('test-photo-id');
      
      expect(photo).toMatchObject({
        id: 'test-photo-id',
        blob: expect.any(Blob),
        width: 1920,
        height: 1080,
      });
    });

    it('should return null for non-existent photo', async () => {
      const photo = await photoService.loadPhoto('non-existent');
      expect(photo).toBeNull();
    });

    it('should delete photo and revoke URL', async () => {
      const blob = new Blob(['image data'], { type: 'image/jpeg' });
      await db.savePhoto(blob, 'test-photo-id');
      photoService.getObjectUrl('test-photo-id', blob);
      
      await photoService.deletePhoto('test-photo-id');
      
      // Should be deleted from DB
      const photo = await db.getPhoto('test-photo-id');
      expect(photo).toBeUndefined();
      
      // Should revoke URL
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('camera availability', () => {
    it('should detect camera availability', () => {
      // Mock secure context
      Object.defineProperty(window, 'isSecureContext', {
        value: true,
        writable: true,
      });
      
      // Mock mediaDevices
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn() },
        writable: true,
      });
      
      expect(photoService.isCameraAvailable()).toBe(true);
    });

    it('should return false in insecure context', () => {
      Object.defineProperty(window, 'isSecureContext', {
        value: false,
        writable: true,
      });
      
      expect(photoService.isCameraAvailable()).toBe(false);
    });
  });

  describe('storage estimation', () => {
    it('should estimate storage usage', async () => {
      // Mock navigator.storage.estimate
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: vi.fn().mockResolvedValue({
            usage: 10 * 1024 * 1024, // 10MB
            quota: 100 * 1024 * 1024, // 100MB
          }),
        },
        writable: true,
      });
      
      const estimate = await photoService.getStorageEstimate();
      
      expect(estimate).toEqual({
        used: 10 * 1024 * 1024,
        quota: 100 * 1024 * 1024,
        percentage: 10,
      });
    });

    it('should fallback to counting photos in DB', async () => {
      // Remove storage API
      Object.defineProperty(navigator, 'storage', {
        value: undefined,
        writable: true,
      });
      
      // Add some photos to DB
      await db.photos.add({
        id: 'photo-1',
        blob: new Blob([new Uint8Array(1024)]),
        createdAt: new Date().toISOString(),
        size: 1024,
        mime: 'image/jpeg',
      });
      
      await db.photos.add({
        id: 'photo-2',
        blob: new Blob([new Uint8Array(2048)]),
        createdAt: new Date().toISOString(),
        size: 2048,
        mime: 'image/jpeg',
      });
      
      const estimate = await photoService.getStorageEstimate();
      
      expect(estimate.used).toBe(3072); // 1024 + 2048
      expect(estimate.quota).toBe(50 * 1024 * 1024); // 50MB fallback
    });
  });
});