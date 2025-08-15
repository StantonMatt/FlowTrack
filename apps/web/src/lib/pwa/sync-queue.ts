import { Queue } from '@serwist/background-sync';
// These are only available in service worker context
// import { registerRoute } from '@serwist/routing';
// import { NetworkOnly } from '@serwist/strategies';
import { createClient } from '@supabase/supabase-js';

// Configuration for the sync queue
const QUEUE_NAME = 'readings-sync-queue';
const MAX_RETENTION_TIME = 7 * 24 * 60; // 7 days in minutes
const MAX_RETRY_DELAY = 60 * 60 * 1000; // 1 hour in milliseconds

// Exponential backoff configuration
const INITIAL_RETRY_DELAY = 5000; // 5 seconds
const BACKOFF_MULTIPLIER = 2;
const JITTER_FACTOR = 0.3; // 30% jitter

/**
 * Calculate retry delay with exponential backoff and jitter
 */
function calculateRetryDelay(retryCount: number): number {
  const exponentialDelay = Math.min(
    INITIAL_RETRY_DELAY * Math.pow(BACKOFF_MULTIPLIER, retryCount),
    MAX_RETRY_DELAY
  );
  
  // Add jitter to prevent thundering herd
  const jitter = exponentialDelay * JITTER_FACTOR * Math.random();
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Plugin to handle photo uploads to Supabase Storage
 */
class PhotoUploadPlugin {
  private supabase: any = null;

  async requestWillEnqueue({ request }: { request: Request }) {
    // Check if this is a reading with photo data
    const body = await request.clone().text();
    try {
      const data = JSON.parse(body);
      if (data.photo_data) {
        // Store photo data separately for later upload
        await this.storePhotoForSync(data);
      }
    } catch (error) {
      // Not JSON or no photo data, skip
    }
  }

  async requestWillReplay({ request }: { request: Request }) {
    // Upload any pending photos before replaying request
    const body = await request.clone().text();
    try {
      const data = JSON.parse(body);
      if (data.reading_id && data.photo_data) {
        const photoUrl = await this.uploadPhoto(data);
        if (photoUrl) {
          // Update request with photo URL instead of base64 data
          const updatedData = { ...data, photo_url: photoUrl };
          delete updatedData.photo_data;
          
          const headers = new Headers(request.headers);
          return new Request(request.url, {
            method: request.method,
            headers,
            body: JSON.stringify(updatedData),
            mode: request.mode,
            credentials: request.credentials,
          });
        }
      }
    } catch (error) {
      console.error('[Photo Upload] Failed to process photo:', error);
    }
    return request;
  }

  private async storePhotoForSync(data: any) {
    try {
      const { openDB } = await import('idb');
      const db = await openDB('FlowTrackOffline', 3);
      const tx = db.transaction('pendingPhotos', 'readwrite');
      const store = tx.objectStore('pendingPhotos');
      
      await store.add({
        reading_id: data.reading_id || crypto.randomUUID(),
        photo_data: data.photo_data,
        mime_type: data.photo_mime_type || 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: data.tenant_id,
      });
      
      await tx.complete;
      console.log('[Photo Upload] Photo stored for later upload');
    } catch (error) {
      console.error('[Photo Upload] Failed to store photo:', error);
    }
  }

  private async uploadPhoto(data: any): Promise<string | null> {
    try {
      // Initialize Supabase client if not already done
      if (!this.supabase) {
        const authState = await this.getAuthState();
        if (!authState?.supabaseUrl || !authState?.supabaseAnonKey) {
          console.error('[Photo Upload] Missing Supabase credentials');
          return null;
        }
        
        this.supabase = createClient(
          authState.supabaseUrl,
          authState.supabaseAnonKey,
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          }
        );
      }

      // Convert base64 to blob
      const base64Data = data.photo_data.replace(/^data:image\/\w+;base64,/, '');
      const binaryData = atob(base64Data);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: data.photo_mime_type || 'image/jpeg' });

      // Upload to Supabase Storage
      const fileName = `readings/${data.tenant_id}/${data.reading_id || crypto.randomUUID()}_${Date.now()}.jpg`;
      const { data: uploadData, error } = await this.supabase.storage
        .from('meter-photos')
        .upload(fileName, blob, {
          contentType: data.photo_mime_type || 'image/jpeg',
          upsert: false,
        });

      if (error) {
        console.error('[Photo Upload] Upload failed:', error);
        return null;
      }

      // Get public URL
      const { data: { publicUrl } } = this.supabase.storage
        .from('meter-photos')
        .getPublicUrl(fileName);

      console.log('[Photo Upload] Photo uploaded successfully:', publicUrl);
      
      // Clean up stored photo data
      await this.removeStoredPhoto(data.reading_id);
      
      return publicUrl;
    } catch (error) {
      console.error('[Photo Upload] Failed to upload photo:', error);
      return null;
    }
  }

  private async removeStoredPhoto(readingId: string) {
    try {
      const { openDB } = await import('idb');
      const db = await openDB('FlowTrackOffline', 3);
      const tx = db.transaction('pendingPhotos', 'readwrite');
      const store = tx.objectStore('pendingPhotos');
      await store.delete(readingId);
      await tx.complete;
    } catch (error) {
      console.error('[Photo Upload] Failed to remove stored photo:', error);
    }
  }

  private async getAuthState(): Promise<any> {
    try {
      const { openDB } = await import('idb');
      const db = await openDB('FlowTrackOffline', 3);
      const tx = db.transaction('readingsQueue', 'readonly');
      const store = tx.objectStore('readingsQueue');
      const authRecord = await store.get(-1);
      
      if (authRecord && authRecord.idempotencyKey === 'AUTH_STATE') {
        return authRecord.payload;
      }
    } catch (error) {
      console.error('[Photo Upload] Failed to get auth state:', error);
    }
    return null;
  }
}

/**
 * Custom plugin to add idempotency headers and handle retries
 */
class IdempotencyPlugin {
  private readonly idempotencyKeys = new Map<string, string>();

  async requestWillEnqueue({ request }: { request: Request }) {
    // Generate or retrieve idempotency key for this request
    const body = await request.clone().text();
    const key = this.getOrCreateIdempotencyKey(body);
    
    // Add idempotency key to headers
    const headers = new Headers(request.headers);
    headers.set('Idempotency-Key', key);
    
    return new Request(request.url, {
      method: request.method,
      headers,
      body,
      mode: request.mode,
      credentials: request.credentials,
    });
  }

  async requestWillReplay({ request }: { request: Request }) {
    // Ensure auth headers are fresh
    const authState = await this.getAuthState();
    if (authState?.accessToken) {
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${authState.accessToken}`);
      if (authState.tenantId) {
        headers.set('X-Tenant-Id', authState.tenantId);
      }
      
      return new Request(request.url, {
        method: request.method,
        headers,
        body: request.body,
        mode: request.mode,
        credentials: request.credentials,
      });
    }
    
    return request;
  }

  private getOrCreateIdempotencyKey(body: string): string {
    // Use body hash as basis for idempotency key
    const hash = this.simpleHash(body);
    
    if (!this.idempotencyKeys.has(hash)) {
      this.idempotencyKeys.set(hash, crypto.randomUUID());
    }
    
    return this.idempotencyKeys.get(hash)!;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  private async getAuthState(): Promise<any> {
    try {
      // Try to get from IndexedDB
      const { openDB } = await import('idb');
      const db = await openDB('FlowTrackOffline', 3);
      const tx = db.transaction('readingsQueue', 'readonly');
      const store = tx.objectStore('readingsQueue');
      const authRecord = await store.get(-1);
      
      if (authRecord && authRecord.idempotencyKey === 'AUTH_STATE') {
        return authRecord.payload;
      }
    } catch (error) {
      console.error('Failed to get auth state:', error);
    }
    return null;
  }
}

/**
 * Custom plugin for telemetry and logging
 */
class TelemetryPlugin {
  private syncAttempts = 0;
  private successCount = 0;
  private failureCount = 0;
  private readonly startTime = Date.now();

  async requestWillEnqueue({ request }: { request: Request }) {
    console.log('[Sync Queue] Request enqueued:', request.url);
  }

  async requestWillReplay({ request, queueSize }: { request: Request; queueSize: number }) {
    this.syncAttempts++;
    console.log(`[Sync Queue] Replaying request (${this.syncAttempts}), queue size: ${queueSize}`);
  }

  async fetchDidSucceed({ request, response }: { request: Request; response: Response }) {
    this.successCount++;
    console.log('[Sync Queue] Request succeeded:', request.url, response.status);
    
    // Send telemetry if enough data accumulated
    if (this.successCount % 10 === 0) {
      this.sendTelemetry();
    }
  }

  async fetchDidFail({ request, error }: { request: Request; error: Error }) {
    this.failureCount++;
    console.error('[Sync Queue] Request failed:', request.url, error);
  }

  private async sendTelemetry() {
    const metrics = {
      syncAttempts: this.syncAttempts,
      successCount: this.successCount,
      failureCount: this.failureCount,
      uptime: Date.now() - this.startTime,
      timestamp: new Date().toISOString(),
    };

    try {
      // Best-effort telemetry send
      await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'sync-queue-metrics', metrics }),
      });
    } catch (error) {
      // Ignore telemetry failures
    }
  }
}

/**
 * Initialize the background sync queue
 */
export function initializeSyncQueue() {
  // Create the queue with plugins
  const queue = new Queue(QUEUE_NAME, {
    maxRetentionTime: MAX_RETENTION_TIME,
    onSync: async ({ queue }) => {
      let entry;
      while ((entry = await queue.shiftRequest())) {
        try {
          // Calculate retry delay based on attempt count
          const metadata = entry.metadata || {};
          const retryCount = metadata.retryCount || 0;
          
          if (retryCount > 0) {
            const delay = calculateRetryDelay(retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          // Attempt the request
          const response = await fetch(entry.request.clone());
          
          if (response.ok) {
            console.log('[Sync Queue] Request synced successfully');
          } else if (response.status >= 400 && response.status < 500) {
            // Client error, don't retry
            console.error('[Sync Queue] Client error, not retrying:', response.status);
          } else {
            // Server error, requeue with incremented retry count
            await queue.unshiftRequest({
              ...entry,
              metadata: {
                ...metadata,
                retryCount: retryCount + 1,
                lastAttempt: Date.now(),
              },
            });
          }
        } catch (error) {
          console.error('[Sync Queue] Sync failed:', error);
          
          // Requeue the request
          const metadata = entry.metadata || {};
          await queue.unshiftRequest({
            ...entry,
            metadata: {
              ...metadata,
              retryCount: (metadata.retryCount || 0) + 1,
              lastAttempt: Date.now(),
              lastError: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
      }
    },
  });

  // Add plugins
  queue.addPlugin(new PhotoUploadPlugin());
  queue.addPlugin(new IdempotencyPlugin());
  queue.addPlugin(new TelemetryPlugin());

  // Register route for sync endpoint
  registerRoute(
    ({ url }) => url.pathname === '/api/readings/sync',
    new NetworkOnly({
      plugins: [queue],
    }),
    'POST'
  );

  // Also handle individual reading posts
  registerRoute(
    ({ url }) => url.pathname === '/api/readings',
    new NetworkOnly({
      plugins: [queue],
    }),
    'POST'
  );

  // Handle bulk uploads
  registerRoute(
    ({ url }) => url.pathname === '/api/readings/bulk',
    new NetworkOnly({
      plugins: [queue],
    }),
    'POST'
  );

  console.log('[Sync Queue] Initialized with queue:', QUEUE_NAME);
  
  return queue;
}

/**
 * Manually trigger sync (for testing or user action)
 */
export async function triggerManualSync(): Promise<void> {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).sync.register('sync-readings');
      console.log('[Sync Queue] Manual sync triggered');
    } catch (error) {
      console.error('[Sync Queue] Failed to trigger manual sync:', error);
      
      // Fallback: send message to service worker
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'TRIGGER_SYNC',
        });
      }
    }
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStatistics(): Promise<{
  size: number;
  oldestEntry: Date | null;
}> {
  try {
    const { openDB } = await import('idb');
    const db = await openDB('workbox-background-sync');
    const tx = db.transaction('requests', 'readonly');
    const store = tx.objectStore('requests');
    const requests = await store.getAll();
    
    const queueRequests = requests.filter(
      (req: any) => req.queueName === QUEUE_NAME
    );
    
    const oldestEntry = queueRequests.length > 0
      ? new Date(Math.min(...queueRequests.map((r: any) => r.timestamp)))
      : null;
    
    return {
      size: queueRequests.length,
      oldestEntry,
    };
  } catch (error) {
    console.error('[Sync Queue] Failed to get statistics:', error);
    return {
      size: 0,
      oldestEntry: null,
    };
  }
}

/**
 * Clear the sync queue (for debugging/recovery)
 */
export async function clearSyncQueue(): Promise<void> {
  try {
    const { openDB } = await import('idb');
    const db = await openDB('workbox-background-sync');
    const tx = db.transaction('requests', 'readwrite');
    const store = tx.objectStore('requests');
    const requests = await store.getAll();
    
    for (const request of requests) {
      if ((request as any).queueName === QUEUE_NAME) {
        await store.delete(request.id);
      }
    }
    
    await tx.complete;
    console.log('[Sync Queue] Queue cleared');
  } catch (error) {
    console.error('[Sync Queue] Failed to clear queue:', error);
  }
}

/**
 * Upload all pending photos
 */
export async function uploadPendingPhotos(): Promise<{
  uploaded: number;
  failed: number;
}> {
  const stats = { uploaded: 0, failed: 0 };
  
  try {
    const { openDB } = await import('idb');
    const db = await openDB('FlowTrackOffline', 3);
    const tx = db.transaction('pendingPhotos', 'readonly');
    const store = tx.objectStore('pendingPhotos');
    const photos = await store.getAll();
    
    const plugin = new PhotoUploadPlugin();
    
    for (const photo of photos) {
      const result = await plugin.uploadPhoto(photo);
      if (result) {
        stats.uploaded++;
      } else {
        stats.failed++;
      }
    }
    
    console.log('[Photo Upload] Batch upload complete:', stats);
  } catch (error) {
    console.error('[Photo Upload] Failed to upload pending photos:', error);
  }
  
  return stats;
}

/**
 * Get pending photo count
 */
export async function getPendingPhotoCount(): Promise<number> {
  try {
    const { openDB } = await import('idb');
    const db = await openDB('FlowTrackOffline', 3);
    const tx = db.transaction('pendingPhotos', 'readonly');
    const store = tx.objectStore('pendingPhotos');
    const count = await store.count();
    return count;
  } catch (error) {
    console.error('[Photo Upload] Failed to get pending photo count:', error);
    return 0;
  }
}

// Export singleton sync queue instance for browser context
export const syncQueue = typeof window !== 'undefined' ? {
  enqueue: enqueueRequest,
  getQueue: getQueuedRequests,
  retry: retrySyncRequest,
  clear: clearSyncQueue,
  uploadPhotos: uploadPendingPhotos,
  getPendingPhotoCount,
} : null;