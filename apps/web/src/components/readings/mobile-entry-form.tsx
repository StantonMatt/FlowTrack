'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Camera, Save, Search, Wifi, WifiOff, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { offlineManager } from '@/lib/pwa/offline-manager';
import { syncQueue } from '@/lib/pwa/sync-queue';
import { db } from '@/lib/pwa/db';

const readingSchema = z.object({
  customerId: z.string().uuid('Please select a customer'),
  reading: z.number().positive('Reading must be positive'),
  readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metadata: z.object({
    readBy: z.string().optional(),
    method: z.enum(['manual', 'automated', 'estimated']).default('manual'),
    location: z.string().optional(),
  }).optional(),
});

type ReadingFormData = z.infer<typeof readingSchema>;

interface MobileEntryFormProps {
  tenantId: string;
  className?: string;
}

export function MobileEntryForm({ tenantId, className }: MobileEntryFormProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [lastReading, setLastReading] = useState<any>(null);
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<ReadingFormData>({
    resolver: zodResolver(readingSchema),
    defaultValues: {
      readingDate: format(new Date(), 'yyyy-MM-dd'),
      metadata: {
        method: 'manual',
      },
    },
  });

  const watchReading = watch('reading');

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Search for customer
  const searchCustomer = useCallback(async () => {
    if (!accountSearch || accountSearch.length < 3) {
      toast.error('Please enter at least 3 characters');
      return;
    }

    setSearching(true);
    try {
      // Try online first
      if (isOnline) {
        const response = await fetch(`/api/customers?search=${accountSearch}`);
        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data.length > 0) {
            const customer = data.data[0];
            setSelectedCustomer(customer);
            setValue('customerId', customer.id);
            
            // Fetch last reading
            const readingResponse = await fetch(
              `/api/readings?customerId=${customer.id}&limit=1&sortBy=readingDate&sortOrder=desc`
            );
            if (readingResponse.ok) {
              const readingData = await readingResponse.json();
              if (readingData.data && readingData.data.length > 0) {
                setLastReading(readingData.data[0]);
              }
            }
          } else {
            toast.error('Customer not found');
          }
        }
      } else {
        // Offline: Try to find in IndexedDB
        const offlineCustomer = await db.customers
          .where('account_number')
          .equals(accountSearch)
          .first();
          
        if (offlineCustomer) {
          setSelectedCustomer(offlineCustomer);
          setValue('customerId', offlineCustomer.id);
          
          // Get last reading from offline DB
          const offlineReading = await db.readings
            .where('customer_id')
            .equals(offlineCustomer.id)
            .reverse()
            .first();
            
          if (offlineReading) {
            setLastReading(offlineReading);
          }
        } else {
          toast.error('Customer not found offline');
        }
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error('Failed to search customer');
    } finally {
      setSearching(false);
    }
  }, [accountSearch, isOnline, setValue]);

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraActive(true);
      }
    } catch (error) {
      console.error('Camera error:', error);
      toast.error('Failed to access camera');
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Capture photo
  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPhotoData(dataUrl);
        stopCamera();
        toast.success('Photo captured');
      }
    }
  };

  // Submit reading
  const onSubmit = async (data: ReadingFormData) => {
    if (!selectedCustomer) {
      toast.error('Please select a customer first');
      return;
    }

    setSubmitting(true);
    
    try {
      const readingData = {
        ...data,
        photoData,
        metadata: {
          ...data.metadata,
          offlineTimestamp: !isOnline ? new Date().toISOString() : undefined,
        },
      };

      if (isOnline) {
        // Online submission
        const response = await fetch('/api/readings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(readingData),
        });

        if (response.ok) {
          const result = await response.json();
          toast.success('Reading submitted successfully');
          
          // Reset form
          reset();
          setSelectedCustomer(null);
          setLastReading(null);
          setPhotoData(null);
          setAccountSearch('');
        } else {
          throw new Error('Failed to submit reading');
        }
      } else {
        // Offline: Queue for sync
        const queueItem = {
          id: crypto.randomUUID(),
          type: 'reading',
          data: readingData,
          timestamp: Date.now(),
          retries: 0,
        };

        // Store in IndexedDB
        await db.syncQueue.add(queueItem);
        
        // Add to sync queue
        await syncQueue.add(queueItem);
        
        toast.success('Reading saved offline. Will sync when online.');
        
        // Reset form
        reset();
        setSelectedCustomer(null);
        setLastReading(null);
        setPhotoData(null);
        setAccountSearch('');
      }
    } catch (error) {
      console.error('Submit error:', error);
      toast.error('Failed to submit reading');
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate consumption preview
  const consumptionPreview = 
    watchReading && lastReading?.reading_value
      ? watchReading - lastReading.reading_value
      : null;

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <Card className={cn("w-full max-w-lg mx-auto", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>New Reading</CardTitle>
            <CardDescription>Enter meter reading details</CardDescription>
          </div>
          <Badge variant={isOnline ? "default" : "secondary"}>
            {isOnline ? (
              <>
                <Wifi className="h-3 w-3 mr-1" />
                Online
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 mr-1" />
                Offline
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Customer Search */}
        <div className="space-y-2">
          <Label>Customer Account</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Enter account number"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchCustomer()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={searchCustomer}
              disabled={searching}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Selected Customer */}
        {selectedCustomer && (
          <Alert>
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-medium">{selectedCustomer.full_name}</p>
                <p className="text-sm text-muted-foreground">
                  Account: {selectedCustomer.account_number}
                </p>
                {lastReading && (
                  <div className="mt-2 pt-2 border-t">
                    <p className="text-xs text-muted-foreground">Last Reading</p>
                    <p className="text-sm">
                      {lastReading.reading_value} on {lastReading.reading_date}
                    </p>
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Reading Value */}
          <div className="space-y-2">
            <Label htmlFor="reading">Meter Reading</Label>
            <Input
              id="reading"
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter current reading"
              {...register('reading', { valueAsNumber: true })}
              className="text-2xl font-mono h-14"
            />
            {errors.reading && (
              <p className="text-sm text-destructive">{errors.reading.message}</p>
            )}
            
            {consumptionPreview !== null && (
              <div className="text-sm text-muted-foreground">
                Consumption: {consumptionPreview > 0 ? '+' : ''}{consumptionPreview} m³
                {consumptionPreview < 0 && (
                  <Badge variant="destructive" className="ml-2">Negative</Badge>
                )}
              </div>
            )}
          </div>

          {/* Reading Date */}
          <div className="space-y-2">
            <Label htmlFor="readingDate">Reading Date</Label>
            <Input
              id="readingDate"
              type="date"
              {...register('readingDate')}
            />
            {errors.readingDate && (
              <p className="text-sm text-destructive">{errors.readingDate.message}</p>
            )}
          </div>

          {/* Photo Capture */}
          <div className="space-y-2">
            <Label>Meter Photo</Label>
            
            {!cameraActive && !photoData && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={startCamera}
              >
                <Camera className="h-4 w-4 mr-2" />
                Take Photo
              </Button>
            )}

            {cameraActive && (
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg"
                />
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
                  <Button
                    type="button"
                    onClick={capturePhoto}
                    className="rounded-full"
                  >
                    Capture
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={stopCamera}
                    className="rounded-full"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {photoData && (
              <div className="relative">
                <img
                  src={photoData}
                  alt="Meter photo"
                  className="w-full rounded-lg"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2"
                  onClick={() => setPhotoData(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Input
              id="notes"
              placeholder="Any observations"
              {...register('metadata.location')}
            />
          </div>

          <Separator />

          {/* Submit Button */}
          <Button
            type="submit"
            className="w-full"
            disabled={!selectedCustomer || submitting}
          >
            {submitting ? (
              <>Submitting...</>
            ) : isOnline ? (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Submit Reading
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Offline
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}