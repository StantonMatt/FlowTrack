'use client';

import { useRef } from 'react';
import { usePhotoCapture } from '@/hooks/use-photo-capture';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Upload, X, Trash2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CapturedPhoto } from '@/lib/media/photo-service';

export interface PhotoCaptureProps {
  onPhotoCapture?: (photo: CapturedPhoto) => void;
  className?: string;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export function PhotoCapture({
  onPhotoCapture,
  className,
  maxWidth = 1920,
  maxHeight = 1080,
  quality = 0.85,
}: PhotoCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const {
    capturedPhoto,
    previewUrl,
    isCapturing,
    isCameraAvailable,
    storageEstimate,
    capturePhoto,
    processFile,
    clearPhoto,
    deletePhoto,
  } = usePhotoCapture({
    maxWidth,
    maxHeight,
    quality,
    onCapture: onPhotoCapture,
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card className={cn('p-4', className)}>
      <div className="space-y-4">
        {/* Storage indicator */}
        {storageEstimate && storageEstimate.percentage > 50 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>
              Storage: {Math.round(storageEstimate.percentage)}% used
              ({formatFileSize(storageEstimate.used)} / {formatFileSize(storageEstimate.quota)})
            </span>
          </div>
        )}

        {/* Capture buttons */}
        {!capturedPhoto && (
          <div className="flex gap-2">
            {isCameraAvailable && (
              <Button
                onClick={capturePhoto}
                disabled={isCapturing}
                className="flex-1"
              >
                <Camera className="h-4 w-4 mr-2" />
                {isCapturing ? 'Opening camera...' : 'Take Photo'}
              </Button>
            )}
            
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isCapturing}
              className={cn(
                'flex-1',
                !isCameraAvailable && 'w-full'
              )}
            >
              <Upload className="h-4 w-4 mr-2" />
              Choose File
            </Button>
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              aria-label="Choose photo file"
            />
          </div>
        )}

        {/* Photo preview */}
        {capturedPhoto && previewUrl && (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-muted">
              <img
                src={previewUrl}
                alt="Captured meter reading"
                className="w-full h-auto max-h-64 object-contain"
              />
              
              {/* Close button */}
              <button
                onClick={clearPhoto}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 hover:bg-background transition-colors"
                aria-label="Remove photo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Photo info */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {capturedPhoto.width} × {capturedPhoto.height} • {formatFileSize(capturedPhoto.size)}
              </span>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={deletePhoto}
                className="h-8 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            </div>

            {/* Retake button */}
            <Button
              variant="outline"
              onClick={() => {
                clearPhoto();
                capturePhoto();
              }}
              disabled={isCapturing}
              className="w-full"
            >
              <Camera className="h-4 w-4 mr-2" />
              Retake Photo
            </Button>
          </div>
        )}

        {/* Camera not available message */}
        {!isCameraAvailable && (
          <div className="text-sm text-muted-foreground text-center py-2">
            <p>Camera not available. You can still upload photos from your device.</p>
            {!window.isSecureContext && (
              <p className="text-xs mt-1">Camera requires a secure connection (HTTPS).</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}