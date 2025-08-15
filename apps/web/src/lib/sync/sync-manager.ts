import { db, type ReadingQueueItem } from '@/lib/db/offline';
import { getAuthState, isTokenExpired, requestTokenRefresh } from '@/lib/pwa/auth-sync';
import { photoUploadService } from '@/lib/sync/photo-upload';
import { telemetryService } from '@/lib/sync/telemetry';
import { EventEmitter } from 'events';

export interface SyncProgress {
  total: number;
  synced: number;
  failed: number;
  inProgress: boolean;
  lastSyncAt?: Date;
}

export interface SyncOptions {
  batchSize?: number;
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitterFactor?: number;
}

const DEFAULT_OPTIONS: Required<SyncOptions> = {
  batchSize: 50,
  maxRetries: 5,
  baseDelay: 1000, // 1 second
  maxDelay: 60000, // 1 minute
  jitterFactor: 0.3,
};

class SyncManager extends EventEmitter {
  private options: Required<SyncOptions>;
  private isSyncing = false;
  private syncPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private retryTimeouts: Map<number, NodeJS.Timeout> = new Map();

  constructor(options: SyncOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if sync is currently in progress
   */
  public isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }

  /**
   * Schedule a sync operation
   */
  public schedule(delayMs = 0): void {
    setTimeout(() => {
      if (!this.isSyncing) {
        this.sync().catch(err => {
          console.error('Scheduled sync failed:', err);
        });
      }
    }, delayMs);
  }

  /**
   * Main sync operation
   */
  public async sync(): Promise<void> {
    // Prevent concurrent syncs
    if (this.isSyncing && this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = this._performSync();
    return this.syncPromise;
  }

  /**
   * Cancel ongoing sync
   */
  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    
    // Clear all retry timeouts
    this.retryTimeouts.forEach(timeout => clearTimeout(timeout));
    this.retryTimeouts.clear();
    
    this.isSyncing = false;
    this.syncPromise = null;
  }

  private async _performSync(): Promise<void> {
    this.isSyncing = true;
    this.abortController = new AbortController();
    
    // Start telemetry session
    telemetryService.startSession();
    telemetryService.logEvent('sync_started');
    
    const progress: SyncProgress = {
      total: 0,
      synced: 0,
      failed: 0,
      inProgress: true,
    };

    try {
      // Get auth state
      const authState = await getAuthState();
      if (!authState?.tenantId || !authState?.accessToken) {
        throw new Error('No auth state available for sync');
      }

      // Check if token is expired and refresh if needed
      if (isTokenExpired(authState.expiresAt)) {
        const refreshedState = await requestTokenRefresh();
        if (!refreshedState?.accessToken) {
          throw new Error('Failed to refresh expired token');
        }
      }

      // Get pending readings
      const pendingReadings = await db.getPendingReadings(authState.tenantId);
      progress.total = pendingReadings.length;

      if (progress.total === 0) {
        this.emit('progress', progress);
        return;
      }

      // Process in batches
      const batches = this.createBatches(pendingReadings, this.options.batchSize);
      
      for (const batch of batches) {
        if (this.abortController.signal.aborted) {
          break;
        }

        await this.processBatch(batch, authState, progress);
        this.emit('progress', { ...progress });
      }

      progress.inProgress = false;
      progress.lastSyncAt = new Date();
      
      // End telemetry session
      const telemetry = telemetryService.endSession();
      if (telemetry) {
        telemetryService.logEvent('sync_completed', {
          duration: telemetry.duration,
          successCount: telemetry.successCount,
          failureCount: telemetry.failureCount,
        });
      }
      
      this.emit('complete', progress);
    } catch (error) {
      console.error('Sync failed:', error);
      progress.inProgress = false;
      
      // Track sync failure in telemetry
      telemetryService.logEvent('sync_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      telemetryService.endSession();
      
      this.emit('error', error);
      throw error;
    } finally {
      this.isSyncing = false;
      this.syncPromise = null;
      this.abortController = null;
    }
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async processBatch(
    batch: ReadingQueueItem[],
    authState: any,
    progress: SyncProgress
  ): Promise<void> {
    const promises = batch.map(reading => 
      this.syncReading(reading, authState, progress)
    );
    
    await Promise.allSettled(promises);
  }

  private async syncReading(
    reading: ReadingQueueItem,
    authState: any,
    progress: SyncProgress
  ): Promise<void> {
    if (!reading.id) return;

    // Track attempt in telemetry
    telemetryService.trackAttempt(reading.id.toString(), {
      hasPhoto: !!reading.photoBlobRef,
      isRetry: reading.retries > 0,
    });

    try {
      // Calculate delay with exponential backoff and jitter
      const delay = this.calculateBackoffDelay(reading.retries);
      
      // Wait with jitter
      await this.delay(delay);

      if (this.abortController?.signal.aborted) {
        return;
      }

      // Prepare headers with auth and idempotency key
      const headers = new Headers({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authState.accessToken}`,
        'X-Tenant-Id': authState.tenantId,
        'X-Idempotency-Key': reading.idempotencyKey,
      });

      // Upload photo to Supabase Storage if exists
      let photoUrl = null;
      if (reading.photoBlobRef) {
        const photo = await db.getPhoto(String(reading.photoBlobRef));
        if (photo) {
          // Upload to Supabase Storage
          const uploadResult = await photoUploadService.uploadPhoto(photo.blob, {
            tenantId: authState.tenantId,
            customerId: reading.payload.customerId,
            readingId: reading.payload.id,
            idempotencyKey: reading.idempotencyKey,
          });

          if (uploadResult.success) {
            photoUrl = uploadResult.url;
            console.log(`Photo uploaded successfully for reading ${reading.id}:`, uploadResult.path);
            telemetryService.logEvent('photo_uploaded', { readingId: reading.id });
          } else {
            console.error(`Failed to upload photo for reading ${reading.id}:`, uploadResult.error);
            telemetryService.logEvent('photo_upload_failed', { 
              readingId: reading.id, 
              error: uploadResult.error 
            });
            // Continue with sync even if photo upload fails
          }
        }
      }

      // Prepare payload with LWW fields
      const payload = {
        ...reading.payload,
        photoUrl, // Include URL instead of base64 data
        updatedAt: reading.updatedAt,
        clientId: reading.id,
        idempotencyKey: reading.idempotencyKey,
      };

      // Send to server
      const response = await fetch('/api/readings', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: this.abortController?.signal,
      });

      if (response.ok) {
        // Mark as synced
        await db.markReadingAsSynced(reading.id);
        progress.synced++;
        
        // Track success in telemetry
        telemetryService.trackSuccess(reading.id.toString(), {
          photoUploaded: !!photoUrl,
        });
        
        // Clean up photo if exists
        if (reading.photoBlobRef) {
          await db.deletePhoto(String(reading.photoBlobRef));
        }
      } else if (response.status === 409) {
        // Conflict - already exists (idempotency)
        await db.markReadingAsSynced(reading.id);
        progress.synced++;
        telemetryService.trackSuccess(reading.id.toString());
      } else if (response.status === 401) {
        // Auth failed - stop processing
        throw new Error('Authentication failed');
      } else if (response.status >= 500) {
        // Server error - retry
        await this.handleRetry(reading, progress);
      } else {
        // Client error - don't retry
        console.error(`Failed to sync reading ${reading.id}: ${response.status}`);
        progress.failed++;
        
        // Mark as failed after max retries
        if (reading.retries >= this.options.maxRetries) {
          // Could move to a failed queue or delete
          await db.readingsQueue.delete(reading.id);
        }
      }
    } catch (error) {
      console.error(`Error syncing reading ${reading.id}:`, error);
      telemetryService.trackFailure(
        reading.id.toString(),
        error instanceof Error ? error : String(error)
      );
      await this.handleRetry(reading, progress);
    }
  }

  private async handleRetry(
    reading: ReadingQueueItem,
    progress: SyncProgress
  ): Promise<void> {
    if (!reading.id) return;
    
    if (reading.retries < this.options.maxRetries) {
      await db.incrementRetryCount(reading.id);
      
      // Schedule retry with backoff
      const retryDelay = this.calculateBackoffDelay(reading.retries + 1);
      const timeout = setTimeout(() => {
        this.retryTimeouts.delete(reading.id!);
        this.syncReading(
          { ...reading, retries: reading.retries + 1 },
          getAuthState(),
          progress
        );
      }, retryDelay);
      
      this.retryTimeouts.set(reading.id, timeout);
    } else {
      // Max retries exceeded
      progress.failed++;
      console.error(`Max retries exceeded for reading ${reading.id}`);
    }
  }

  private calculateBackoffDelay(retryCount: number): number {
    // Exponential backoff with decorrelated jitter
    const exponentialDelay = Math.min(
      this.options.baseDelay * Math.pow(2, retryCount),
      this.options.maxDelay
    );
    
    // Add decorrelated jitter
    const jitter = exponentialDelay * this.options.jitterFactor * Math.random();
    return Math.floor(exponentialDelay + jitter);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current sync progress
   */
  public async getProgress(): Promise<SyncProgress> {
    const authState = await getAuthState();
    if (!authState?.tenantId) {
      return {
        total: 0,
        synced: 0,
        failed: 0,
        inProgress: this.isSyncing,
      };
    }

    const pendingReadings = await db.getPendingReadings(authState.tenantId);
    const allReadings = await db.readingsQueue
      .where('tenantId')
      .equals(authState.tenantId)
      .toArray();
    
    const syncedCount = allReadings.filter(r => r.synced).length;
    const failedCount = allReadings.filter(r => 
      !r.synced && r.retries >= this.options.maxRetries
    ).length;

    return {
      total: allReadings.length,
      synced: syncedCount,
      failed: failedCount,
      inProgress: this.isSyncing,
    };
  }

  /**
   * Register background sync with service worker
   */
  public async registerBackgroundSync(): Promise<void> {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await (registration as any).sync.register('sync-readings');
        console.log('Background sync registered');
      } catch (error) {
        console.error('Failed to register background sync:', error);
      }
    }
  }

  /**
   * Clean up old synced data
   */
  public async cleanup(olderThanDays = 7): Promise<void> {
    await db.clearSyncedReadings(olderThanDays);
    await db.cleanupOldPhotos(olderThanDays * 2);
  }
}

// Export singleton instance
export const syncManager = new SyncManager();

// Auto-schedule cleanup
if (typeof window !== 'undefined') {
  // Run cleanup daily
  setInterval(() => {
    syncManager.cleanup().catch(console.error);
  }, 24 * 60 * 60 * 1000);

  // Register for background sync on load
  syncManager.registerBackgroundSync().catch(console.error);
}