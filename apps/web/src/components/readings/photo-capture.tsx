'use client';

import { useState, useRef, useCallback } from 'react';
import { Camera, Upload, X, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { db } from '@/lib/db/offline';
import { toast } from 'sonner';

interface PhotoCaptureProps {
  onPhotoCapture?: (photoId: string, photoUrl: string) => void;
  maxSizeMB?: number;
  acceptedTypes?: string[];
  tenantId: string;
  readingId?: string;
}

export function PhotoCapture({
  onPhotoCapture,
  maxSizeMB = 5,
  acceptedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  tenantId,
  readingId,
}: PhotoCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback(async (file: File) => {
    // Validate file type
    if (!acceptedTypes.includes(file.type)) {
      toast.error(`Invalid file type. Accepted: ${acceptedTypes.join(', ')}`);
      return;
    }

    // Validate file size
    const maxSize = maxSizeMB * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`File too large. Maximum size: ${maxSizeMB}MB`);
      return;
    }

    setIsProcessing(true);

    try {
      // Create preview
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        setPreview(dataUrl);

        // Store in offline database
        const id = await db.savePhoto(file, readingId);
        setPhotoId(id);

        // Store for sync queue if needed
        if (readingId) {
          await db.pendingPhotos.add({
            reading_id: readingId,
            photo_data: dataUrl,
            mime_type: file.type,
            timestamp: Date.now(),
            tenant_id: tenantId,
          });
        }

        onPhotoCapture?.(id, dataUrl);
        toast.success('Photo captured successfully');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error processing photo:', error);
      toast.error('Failed to process photo');
    } finally {
      setIsProcessing(false);
    }
  }, [acceptedTypes, maxSizeMB, onPhotoCapture, readingId, tenantId]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImage(file);
    }
  }, [processImage]);

  const handleCameraCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImage(file);
    }
  }, [processImage]);

  const removePhoto = useCallback(async () => {
    if (photoId) {
      try {
        await db.deletePhoto(photoId);
        if (readingId) {
          await db.pendingPhotos.delete(readingId);
        }
      } catch (error) {
        console.error('Error removing photo:', error);
      }
    }
    setPreview(null);
    setPhotoId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }, [photoId, readingId]);

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Meter Photo</h3>
        
        {preview ? (
          <div className="relative">
            <img 
              src={preview} 
              alt="Meter reading" 
              className="w-full h-48 object-cover rounded-lg"
            />
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2"
              onClick={removePhoto}
              disabled={isProcessing}
            >
              <X className="h-4 w-4" />
            </Button>
            {photoId && (
              <div className="absolute bottom-2 left-2 bg-green-500 text-white px-2 py-1 rounded-md flex items-center gap-1">
                <Check className="h-3 w-3" />
                <span className="text-xs">Saved offline</span>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {/* Camera capture for mobile */}
            <div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCameraCapture}
                className="hidden"
                disabled={isProcessing}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4 mr-2" />
                )}
                Camera
              </Button>
            </div>

            {/* File upload */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptedTypes.join(',')}
                onChange={handleFileSelect}
                className="hidden"
                disabled={isProcessing}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {preview 
            ? 'Photo will be uploaded when connection is available'
            : `Capture or upload meter photo (max ${maxSizeMB}MB)`
          }
        </p>
      </div>
    </Card>
  );
}