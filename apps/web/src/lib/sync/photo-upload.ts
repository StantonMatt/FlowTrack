import { createClient } from '@/lib/supabase/client';
import type { PhotoBlob } from '@/lib/db/offline';

export interface PhotoUploadResult {
  success: boolean;
  url?: string;
  path?: string;
  error?: string;
}

export interface UploadOptions {
  tenantId: string;
  customerId?: string;
  readingId?: string;
  idempotencyKey: string;
}

/**
 * Service for uploading photos to Supabase Storage
 */
export class PhotoUploadService {
  private supabase = createClient();
  private readonly bucketName = 'reading-photos';
  
  /**
   * Upload a photo blob to Supabase Storage
   */
  async uploadPhoto(
    blob: Blob,
    options: UploadOptions
  ): Promise<PhotoUploadResult> {
    try {
      // Validate blob
      if (!blob || blob.size === 0) {
        return {
          success: false,
          error: 'Invalid or empty blob',
        };
      }

      // Check blob size (max 5MB)
      if (blob.size > 5 * 1024 * 1024) {
        return {
          success: false,
          error: 'Photo size exceeds 5MB limit',
        };
      }

      // Generate path with tenant isolation
      const path = this.generateStoragePath(options);

      // Check if file already exists (idempotency)
      const { data: existingFile } = await this.supabase.storage
        .from(this.bucketName)
        .list(path.substring(0, path.lastIndexOf('/')), {
          search: path.substring(path.lastIndexOf('/') + 1),
        });

      if (existingFile && existingFile.length > 0) {
        // File already exists, return existing URL
        const { data: urlData } = this.supabase.storage
          .from(this.bucketName)
          .getPublicUrl(path);

        return {
          success: true,
          url: urlData.publicUrl,
          path,
        };
      }

      // Upload new file
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(path, blob, {
          contentType: blob.type || 'image/jpeg',
          upsert: false, // Don't overwrite existing files
          cacheControl: '3600',
        });

      if (error) {
        console.error('Upload error:', error);
        
        // Handle duplicate file error
        if (error.message?.includes('duplicate')) {
          const { data: urlData } = this.supabase.storage
            .from(this.bucketName)
            .getPublicUrl(path);

          return {
            success: true,
            url: urlData.publicUrl,
            path,
          };
        }

        return {
          success: false,
          error: error.message,
        };
      }

      // Get public URL for the uploaded file
      const { data: urlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(data.path);

      return {
        success: true,
        url: urlData.publicUrl,
        path: data.path,
      };
    } catch (error) {
      console.error('Photo upload failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  /**
   * Upload a photo from IndexedDB
   */
  async uploadPhotoFromDB(
    photo: PhotoBlob,
    options: UploadOptions
  ): Promise<PhotoUploadResult> {
    return this.uploadPhoto(photo.blob, options);
  }

  /**
   * Generate a signed URL for private access
   */
  async getSignedUrl(
    path: string,
    expiresIn = 3600 // 1 hour default
  ): Promise<{ url?: string; error?: string }> {
    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .createSignedUrl(path, expiresIn);

      if (error) {
        return { error: error.message };
      }

      return { url: data.signedUrl };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to generate signed URL',
      };
    }
  }

  /**
   * Delete a photo from storage
   */
  async deletePhoto(path: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.storage
        .from(this.bucketName)
        .remove([path]);

      if (error) {
        console.error('Delete error:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Photo deletion failed:', error);
      return false;
    }
  }

  /**
   * Batch upload multiple photos
   */
  async uploadBatch(
    photos: Array<{ blob: Blob; options: UploadOptions }>
  ): Promise<PhotoUploadResult[]> {
    // Process uploads in parallel with concurrency limit
    const concurrencyLimit = 3;
    const results: PhotoUploadResult[] = [];
    
    for (let i = 0; i < photos.length; i += concurrencyLimit) {
      const batch = photos.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(({ blob, options }) => this.uploadPhoto(blob, options))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate storage path with tenant isolation
   */
  private generateStoragePath(options: UploadOptions): string {
    const { tenantId, customerId, readingId, idempotencyKey } = options;
    
    // Create hierarchical path for organization
    const parts = [tenantId];
    
    if (customerId) {
      parts.push('customers', customerId);
    }
    
    if (readingId) {
      parts.push('readings', readingId);
    } else {
      parts.push('readings');
    }
    
    // Use idempotency key as filename for deduplication
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${timestamp}_${idempotencyKey}.jpg`;
    
    return [...parts, filename].join('/');
  }

  /**
   * Validate photo blob before upload
   */
  validatePhoto(blob: Blob): { valid: boolean; error?: string } {
    // Check size
    if (blob.size > 5 * 1024 * 1024) {
      return {
        valid: false,
        error: 'Photo exceeds 5MB size limit',
      };
    }

    // Check type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(blob.type)) {
      return {
        valid: false,
        error: `Invalid photo type: ${blob.type}. Supported: JPEG, PNG, WebP`,
      };
    }

    return { valid: true };
  }

  /**
   * Compress photo if needed
   */
  async compressPhoto(
    blob: Blob,
    maxSizeBytes = 5 * 1024 * 1024
  ): Promise<Blob> {
    if (blob.size <= maxSizeBytes) {
      return blob;
    }

    // Use canvas for compression
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Canvas context not available');
    }

    return new Promise((resolve, reject) => {
      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;
        const maxDimension = 2048;
        
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Try different quality levels to get under size limit
        let quality = 0.9;
        const attemptCompression = () => {
          canvas.toBlob(
            (compressedBlob) => {
              if (!compressedBlob) {
                reject(new Error('Failed to compress image'));
                return;
              }

              if (compressedBlob.size <= maxSizeBytes || quality <= 0.1) {
                resolve(compressedBlob);
              } else {
                quality -= 0.1;
                attemptCompression();
              }
            },
            'image/jpeg',
            quality
          );
        };

        attemptCompression();
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(blob);
    });
  }
}

// Export singleton instance
export const photoUploadService = new PhotoUploadService();