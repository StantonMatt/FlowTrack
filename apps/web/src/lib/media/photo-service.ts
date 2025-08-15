import { db } from '@/lib/db/offline';

export interface PhotoCaptureOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  stripExif?: boolean;
  maxSizeBytes?: number;
}

export interface CapturedPhoto {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  size: number;
  objectUrl?: string;
}

const DEFAULT_OPTIONS: Required<PhotoCaptureOptions> = {
  maxWidth: 1920,
  maxHeight: 1080,
  quality: 0.85,
  stripExif: true,
  maxSizeBytes: 5 * 1024 * 1024, // 5MB
};

class PhotoService {
  private objectUrls: Map<string, string> = new Map();

  /**
   * Compress and process an image file
   */
  async processImage(
    file: File | Blob,
    options: PhotoCaptureOptions = {}
  ): Promise<CapturedPhoto> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('Invalid file type. Only images are allowed.');
    }

    // Check initial file size
    if (file.size > opts.maxSizeBytes * 2) {
      throw new Error(`File too large. Maximum size is ${opts.maxSizeBytes / 1024 / 1024}MB`);
    }

    // Load image
    const img = await this.loadImage(file);

    // Calculate new dimensions
    const { width, height } = this.calculateDimensions(
      img.width,
      img.height,
      opts.maxWidth,
      opts.maxHeight
    );

    // Create canvas and draw resized image
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Use better image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw and compress
    ctx.drawImage(img, 0, 0, width, height);

    // Convert to blob with compression
    const blob = await this.canvasToBlob(canvas, opts.quality, opts.maxSizeBytes);

    // Generate ID
    const id = crypto.randomUUID();

    // Store in IndexedDB
    await db.savePhoto(blob, id);

    return {
      id,
      blob,
      width,
      height,
      size: blob.size,
    };
  }

  /**
   * Capture photo from camera input
   */
  async captureFromCamera(options: PhotoCaptureOptions = {}): Promise<CapturedPhoto | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment'; // Use back camera on mobile

      input.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        try {
          const photo = await this.processImage(file, options);
          resolve(photo);
        } catch (error) {
          console.error('Failed to process photo:', error);
          resolve(null);
        }
      };

      // Handle cancel
      input.oncancel = () => resolve(null);

      input.click();
    });
  }

  /**
   * Get object URL for displaying photo
   */
  getObjectUrl(photoId: string, blob?: Blob): string | null {
    // Check if we already have an object URL
    const existing = this.objectUrls.get(photoId);
    if (existing) {
      return existing;
    }

    // Create new object URL if blob provided
    if (blob) {
      const url = URL.createObjectURL(blob);
      this.objectUrls.set(photoId, url);
      return url;
    }

    return null;
  }

  /**
   * Revoke object URL to free memory
   */
  revokeObjectUrl(photoId: string): void {
    const url = this.objectUrls.get(photoId);
    if (url) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(photoId);
    }
  }

  /**
   * Revoke all object URLs
   */
  revokeAllObjectUrls(): void {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.clear();
  }

  /**
   * Load photo from IndexedDB
   */
  async loadPhoto(photoId: string): Promise<CapturedPhoto | null> {
    const photoData = await db.getPhoto(photoId);
    if (!photoData) {
      return null;
    }

    // Load image to get dimensions
    const img = await this.loadImage(photoData.blob);

    return {
      id: photoId,
      blob: photoData.blob,
      width: img.width,
      height: img.height,
      size: photoData.size,
    };
  }

  /**
   * Delete photo from storage
   */
  async deletePhoto(photoId: string): Promise<void> {
    // Revoke object URL if exists
    this.revokeObjectUrl(photoId);
    
    // Delete from IndexedDB
    await db.deletePhoto(photoId);
  }

  /**
   * Load image from blob/file
   */
  private loadImage(source: Blob | File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(source);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  }

  /**
   * Calculate dimensions maintaining aspect ratio
   */
  private calculateDimensions(
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    // Don't upscale
    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }

    const aspectRatio = originalWidth / originalHeight;

    let width = maxWidth;
    let height = maxWidth / aspectRatio;

    if (height > maxHeight) {
      height = maxHeight;
      width = maxHeight * aspectRatio;
    }

    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  /**
   * Convert canvas to blob with quality adjustment
   */
  private async canvasToBlob(
    canvas: HTMLCanvasElement,
    quality: number,
    maxSizeBytes: number
  ): Promise<Blob> {
    let currentQuality = quality;
    let blob: Blob | null = null;

    // Try progressively lower quality until size is acceptable
    while (currentQuality > 0.1) {
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (b) => resolve(b),
          'image/jpeg',
          currentQuality
        );
      });

      if (!blob) {
        throw new Error('Failed to create blob');
      }

      if (blob.size <= maxSizeBytes) {
        return blob;
      }

      // Reduce quality for next iteration
      currentQuality -= 0.1;
    }

    // If we still can't get under the size limit, return the last blob
    if (blob && blob.size <= maxSizeBytes * 1.5) {
      console.warn(`Image size ${blob.size} exceeds limit ${maxSizeBytes}`);
      return blob;
    }

    throw new Error('Unable to compress image to acceptable size');
  }

  /**
   * Check if camera is available
   */
  isCameraAvailable(): boolean {
    // Check if we're in a secure context (HTTPS or localhost)
    if (!window.isSecureContext) {
      return false;
    }

    // Check for media devices API
    return 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
  }

  /**
   * Estimate storage usage
   */
  async getStorageEstimate(): Promise<{
    used: number;
    quota: number;
    percentage: number;
  }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;
      
      return {
        used,
        quota,
        percentage: quota > 0 ? (used / quota) * 100 : 0,
      };
    }

    // Fallback - count photos in DB
    const photos = await db.photos.toArray();
    const used = photos.reduce((sum, photo) => sum + photo.size, 0);
    
    return {
      used,
      quota: 50 * 1024 * 1024, // Assume 50MB quota
      percentage: (used / (50 * 1024 * 1024)) * 100,
    };
  }
}

// Export singleton
export const photoService = new PhotoService();

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    photoService.revokeAllObjectUrls();
  });
}