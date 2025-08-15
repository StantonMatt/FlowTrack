'use client';

import { useState, useCallback, useEffect } from 'react';
import { photoService, type CapturedPhoto, type PhotoCaptureOptions } from '@/lib/media/photo-service';
import { toast } from 'sonner';

export interface UsePhotoCaptureOptions extends PhotoCaptureOptions {
  onCapture?: (photo: CapturedPhoto) => void;
  onError?: (error: Error) => void;
}

export function usePhotoCapture(options: UsePhotoCaptureOptions = {}) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<{
    used: number;
    quota: number;
    percentage: number;
  } | null>(null);

  const { onCapture, onError, ...captureOptions } = options;

  // Update storage estimate
  const updateStorageEstimate = useCallback(async () => {
    try {
      const estimate = await photoService.getStorageEstimate();
      setStorageEstimate(estimate);
      
      // Warn if storage is getting full
      if (estimate.percentage > 80) {
        toast.warning('Storage space running low', {
          description: `${Math.round(estimate.percentage)}% of storage used`,
        });
      }
    } catch (error) {
      console.error('Failed to get storage estimate:', error);
    }
  }, []);

  // Capture photo from camera
  const capturePhoto = useCallback(async () => {
    if (isCapturing) return;

    setIsCapturing(true);
    
    try {
      const photo = await photoService.captureFromCamera(captureOptions);
      
      if (photo) {
        setCapturedPhoto(photo);
        
        // Create preview URL
        const url = photoService.getObjectUrl(photo.id, photo.blob);
        if (url) {
          setPreviewUrl(url);
        }

        // Update storage estimate
        await updateStorageEstimate();

        // Call callback
        onCapture?.(photo);

        toast.success('Photo captured', {
          description: `Size: ${(photo.size / 1024).toFixed(1)}KB`,
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to capture photo');
      console.error('Photo capture failed:', err);
      
      toast.error('Failed to capture photo', {
        description: err.message,
      });
      
      onError?.(err);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, captureOptions, onCapture, onError, updateStorageEstimate]);

  // Process an existing file
  const processFile = useCallback(async (file: File) => {
    if (isCapturing) return;

    setIsCapturing(true);
    
    try {
      const photo = await photoService.processImage(file, captureOptions);
      setCapturedPhoto(photo);
      
      // Create preview URL
      const url = photoService.getObjectUrl(photo.id, photo.blob);
      if (url) {
        setPreviewUrl(url);
      }

      // Update storage estimate
      await updateStorageEstimate();

      // Call callback
      onCapture?.(photo);

      toast.success('Photo processed', {
        description: `Size: ${(photo.size / 1024).toFixed(1)}KB`,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to process photo');
      console.error('Photo processing failed:', err);
      
      toast.error('Failed to process photo', {
        description: err.message,
      });
      
      onError?.(err);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, captureOptions, onCapture, onError, updateStorageEstimate]);

  // Load photo from storage
  const loadPhoto = useCallback(async (photoId: string) => {
    try {
      const photo = await photoService.loadPhoto(photoId);
      
      if (photo) {
        setCapturedPhoto(photo);
        
        // Create preview URL
        const url = photoService.getObjectUrl(photo.id, photo.blob);
        if (url) {
          setPreviewUrl(url);
        }
      }
    } catch (error) {
      console.error('Failed to load photo:', error);
      toast.error('Failed to load photo');
    }
  }, []);

  // Clear captured photo
  const clearPhoto = useCallback(() => {
    if (capturedPhoto) {
      photoService.revokeObjectUrl(capturedPhoto.id);
    }
    setCapturedPhoto(null);
    setPreviewUrl(null);
  }, [capturedPhoto]);

  // Delete photo from storage
  const deletePhoto = useCallback(async () => {
    if (!capturedPhoto) return;

    try {
      await photoService.deletePhoto(capturedPhoto.id);
      clearPhoto();
      
      // Update storage estimate
      await updateStorageEstimate();
      
      toast.success('Photo deleted');
    } catch (error) {
      console.error('Failed to delete photo:', error);
      toast.error('Failed to delete photo');
    }
  }, [capturedPhoto, clearPhoto, updateStorageEstimate]);

  // Check camera availability
  const isCameraAvailable = photoService.isCameraAvailable();

  // Cleanup on unmount
  useEffect(() => {
    // Get initial storage estimate
    updateStorageEstimate();

    return () => {
      // Revoke object URLs on cleanup
      if (capturedPhoto) {
        photoService.revokeObjectUrl(capturedPhoto.id);
      }
    };
  }, []);

  return {
    capturedPhoto,
    previewUrl,
    isCapturing,
    isCameraAvailable,
    storageEstimate,
    capturePhoto,
    processFile,
    loadPhoto,
    clearPhoto,
    deletePhoto,
  };
}