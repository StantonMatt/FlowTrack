import { db } from '@/lib/db/offline';
import { syncManager } from '@/lib/sync/sync-manager';
import type { CreateReading, SyncReading, SyncBatch, SyncResult } from '@shared/schemas/reading';
import type { ReadingQueueItem } from '@/lib/db/offline';

export interface QueuedReading extends ReadingQueueItem {
  photoUrl?: string | null;
}

export interface QueueStatistics {
  total: number;
  pending: number;
  synced: number;
  failed: number;
  oldestPending: Date | null;
  lastSyncAttempt: Date | null;
}

export class OfflineReadingQueue {
  private syncInProgress = false;
  private syncAbortController: AbortController | null = null;

  /**
   * Add a reading to the offline queue
   */
  async queueReading(
    tenantId: string,
    reading: CreateReading,
    options: {
      photoId?: string;
      idempotencyKey?: string;
      priority?: 'normal' | 'high';
    } = {}
  ): Promise<string> {
    const clientId = crypto.randomUUID();
    const idempotencyKey = options.idempotencyKey || crypto.randomUUID();

    // Check for duplicate using idempotency key
    const existing = await db.readingsQueue
      .where('idempotencyKey')
      .equals(idempotencyKey)
      .first();

    if (existing) {
      return existing.clientId;
    }

    // Create queue item
    const queueItem: Omit<ReadingQueueItem, 'id'> = {
      clientId,
      tenantId,
      customerId: reading.customerId,
      readingValue: reading.readingValue,
      readingDate: reading.readingDate,
      metadata: reading.metadata || {},
      photoId: options.photoId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncAttempts: 0,
      lastSyncAttempt: null,
      syncError: null,
      synced: false,
      idempotencyKey,
      priority: options.priority || 'normal',
    };

    await db.readingsQueue.add(queueItem);

    // Register for background sync if high priority
    if (options.priority === 'high') {
      this.requestSync();
    }

    return clientId;
  }

  /**
   * Get all queued readings
   */
  async getQueuedReadings(
    tenantId: string,
    options: {
      includeSynced?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<QueuedReading[]> {
    let query = db.readingsQueue.where('tenantId').equals(tenantId);

    if (!options.includeSynced) {
      query = query.and(item => !item.synced);
    }

    const items = await query
      .offset(options.offset || 0)
      .limit(options.limit || 100)
      .toArray();

    // Add photo URLs for items with photos
    const itemsWithPhotos = await Promise.all(
      items.map(async (item) => {
        let photoUrl: string | null = null;
        
        if (item.photoId) {
          const photo = await db.getPhoto(item.photoId);
          if (photo) {
            photoUrl = URL.createObjectURL(photo.blob);
          }
        }

        return {
          ...item,
          photoUrl,
        };
      })
    );

    return itemsWithPhotos;
  }

  /**
   * Get a specific queued reading
   */
  async getQueuedReading(clientId: string): Promise<QueuedReading | null> {
    const item = await db.readingsQueue
      .where('clientId')
      .equals(clientId)
      .first();

    if (!item) {
      return null;
    }

    let photoUrl: string | null = null;
    if (item.photoId) {
      const photo = await db.getPhoto(item.photoId);
      if (photo) {
        photoUrl = URL.createObjectURL(photo.blob);
      }
    }

    return {
      ...item,
      photoUrl,
    };
  }

  /**
   * Update a queued reading
   */
  async updateQueuedReading(
    clientId: string,
    updates: Partial<CreateReading>
  ): Promise<void> {
    const item = await db.readingsQueue
      .where('clientId')
      .equals(clientId)
      .first();

    if (!item || item.synced) {
      throw new Error('Reading not found or already synced');
    }

    await db.readingsQueue.update(item.id!, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Delete a queued reading
   */
  async deleteQueuedReading(clientId: string): Promise<void> {
    const item = await db.readingsQueue
      .where('clientId')
      .equals(clientId)
      .first();

    if (item) {
      // Delete associated photo if exists
      if (item.photoId) {
        await db.deletePhoto(item.photoId);
      }

      await db.readingsQueue.delete(item.id!);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStatistics(tenantId: string): Promise<QueueStatistics> {
    const items = await db.readingsQueue
      .where('tenantId')
      .equals(tenantId)
      .toArray();

    const pending = items.filter(i => !i.synced);
    const synced = items.filter(i => i.synced);
    const failed = items.filter(i => i.syncError && !i.synced);

    const oldestPending = pending.length > 0
      ? new Date(Math.min(...pending.map(i => new Date(i.createdAt).getTime())))
      : null;

    const lastSyncAttempts = items
      .filter(i => i.lastSyncAttempt)
      .map(i => new Date(i.lastSyncAttempt!).getTime());
    
    const lastSyncAttempt = lastSyncAttempts.length > 0
      ? new Date(Math.max(...lastSyncAttempts))
      : null;

    return {
      total: items.length,
      pending: pending.length,
      synced: synced.length,
      failed: failed.length,
      oldestPending,
      lastSyncAttempt,
    };
  }

  /**
   * Sync queued readings to server
   */
  async syncReadings(
    tenantId: string,
    options: {
      batchSize?: number;
      maxRetries?: number;
      signal?: AbortSignal;
    } = {}
  ): Promise<{
    synced: number;
    failed: number;
    errors: Array<{ clientId: string; error: string }>;
  }> {
    if (this.syncInProgress) {
      throw new Error('Sync already in progress');
    }

    this.syncInProgress = true;
    this.syncAbortController = new AbortController();

    const batchSize = options.batchSize || 10;
    const maxRetries = options.maxRetries || 3;
    const errors: Array<{ clientId: string; error: string }> = [];
    let syncedCount = 0;
    let failedCount = 0;

    try {
      // Get pending readings
      const pendingItems = await db.readingsQueue
        .where('tenantId')
        .equals(tenantId)
        .and(item => !item.synced)
        .and(item => item.syncAttempts < maxRetries)
        .limit(batchSize)
        .toArray();

      if (pendingItems.length === 0) {
        return { synced: 0, failed: 0, errors: [] };
      }

      // Group by batch for efficient syncing
      const batches = this.createBatches(pendingItems, batchSize);

      for (const batch of batches) {
        if (options.signal?.aborted || this.syncAbortController.signal.aborted) {
          break;
        }

        const result = await this.syncBatch(tenantId, batch);
        
        // Update items based on results
        for (const itemResult of result.results) {
          const item = batch.find(i => i.clientId === itemResult.clientId);
          if (!item) continue;

          if (itemResult.success) {
            // Mark as synced
            await db.readingsQueue.update(item.id!, {
              synced: true,
              serverId: itemResult.serverId,
              lastSyncAttempt: new Date().toISOString(),
              syncError: null,
            });
            syncedCount++;

            // Delete photo from local storage if synced
            if (item.photoId) {
              await db.deletePhoto(item.photoId);
            }
          } else {
            // Update sync attempts and error
            await db.readingsQueue.update(item.id!, {
              syncAttempts: item.syncAttempts + 1,
              lastSyncAttempt: new Date().toISOString(),
              syncError: itemResult.error || 'Unknown error',
            });
            failedCount++;
            errors.push({
              clientId: item.clientId,
              error: itemResult.error || 'Unknown error',
            });
          }
        }
      }

      // Clean up old synced items (keep for 7 days)
      await this.cleanupSyncedItems(tenantId);

      return {
        synced: syncedCount,
        failed: failedCount,
        errors,
      };
    } finally {
      this.syncInProgress = false;
      this.syncAbortController = null;
    }
  }

  /**
   * Create batches for syncing
   */
  private createBatches(
    items: ReadingQueueItem[],
    batchSize: number
  ): ReadingQueueItem[][] {
    const batches: ReadingQueueItem[][] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Sync a batch of readings
   */
  private async syncBatch(
    tenantId: string,
    items: ReadingQueueItem[]
  ): Promise<SyncResult> {
    const clientBatchId = crypto.randomUUID();
    
    // Prepare sync items
    const syncItems: SyncReading[] = await Promise.all(
      items.map(async (item) => {
        let photoData: string | undefined;
        
        if (item.photoId) {
          const photo = await db.getPhoto(item.photoId);
          if (photo) {
            // Convert blob to base64
            const reader = new FileReader();
            photoData = await new Promise<string>((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(photo.blob);
            });
          }
        }

        return {
          clientId: item.clientId,
          clientBatchId,
          customerId: item.customerId,
          readingValue: item.readingValue,
          readingDate: item.readingDate,
          metadata: item.metadata,
          photoData,
          updatedAt: item.updatedAt,
        };
      })
    );

    const batch: SyncBatch = {
      clientBatchId,
      items: syncItems,
    };

    // Call sync API
    try {
      const response = await fetch('/api/readings/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
        signal: this.syncAbortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }

      const result: SyncResult = await response.json();
      return result;
    } catch (error) {
      // Return failure for all items
      return {
        clientBatchId,
        success: false,
        results: items.map(item => ({
          clientId: item.clientId,
          success: false,
          error: error instanceof Error ? error.message : 'Sync failed',
        })),
      };
    }
  }

  /**
   * Clean up old synced items
   */
  private async cleanupSyncedItems(tenantId: string): Promise<void> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const oldSyncedItems = await db.readingsQueue
      .where('tenantId')
      .equals(tenantId)
      .and(item => item.synced)
      .and(item => new Date(item.updatedAt) < sevenDaysAgo)
      .toArray();

    for (const item of oldSyncedItems) {
      await db.readingsQueue.delete(item.id!);
    }
  }

  /**
   * Request background sync
   */
  async requestSync(): Promise<void> {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await (registration as any).sync.register('sync-readings');
      } catch (error) {
        console.error('Failed to register background sync:', error);
      }
    }
  }

  /**
   * Cancel ongoing sync
   */
  cancelSync(): void {
    if (this.syncAbortController) {
      this.syncAbortController.abort();
    }
  }

  /**
   * Clear all queued readings for a tenant
   */
  async clearQueue(
    tenantId: string,
    options: {
      includeSynced?: boolean;
    } = {}
  ): Promise<void> {
    let items = await db.readingsQueue
      .where('tenantId')
      .equals(tenantId)
      .toArray();

    if (!options.includeSynced) {
      items = items.filter(i => !i.synced);
    }

    // Delete associated photos
    for (const item of items) {
      if (item.photoId) {
        await db.deletePhoto(item.photoId);
      }
    }

    // Delete queue items
    const ids = items.map(i => i.id!);
    await db.readingsQueue.bulkDelete(ids);
  }

  /**
   * Export queue data for debugging
   */
  async exportQueue(tenantId: string): Promise<string> {
    const items = await db.readingsQueue
      .where('tenantId')
      .equals(tenantId)
      .toArray();

    return JSON.stringify(items, null, 2);
  }

  /**
   * Import queue data (for testing/migration)
   */
  async importQueue(data: string): Promise<void> {
    const items = JSON.parse(data) as ReadingQueueItem[];
    
    for (const item of items) {
      // Remove id to let DB generate new one
      const { id, ...itemData } = item;
      await db.readingsQueue.add(itemData);
    }
  }
}

// Export singleton instance
export const offlineReadingQueue = new OfflineReadingQueue();