import Dexie, { type Table } from 'dexie';

export interface ReadingQueueItem {
  id?: number;
  clientId: string;
  tenantId: string;
  customerId: string;
  readingValue: number;
  readingDate: string;
  metadata?: Record<string, any>;
  photoId?: string;
  createdAt: string;
  updatedAt: string;
  syncAttempts: number;
  lastSyncAttempt: string | null;
  syncError: string | null;
  synced: boolean;
  serverId?: string;
  idempotencyKey: string;
  priority: 'normal' | 'high';
}

export interface PhotoBlob {
  id: string;
  blob: Blob;
  createdAt: string;
  size: number;
  mime: string;
}

export interface PendingPhoto {
  reading_id: string;
  photo_data: string;
  mime_type: string;
  timestamp: number;
  tenant_id: string;
}

export class OfflineDatabase extends Dexie {
  readingsQueue!: Table<ReadingQueueItem>;
  photos!: Table<PhotoBlob>;
  pendingPhotos!: Table<PendingPhoto>;

  constructor() {
    super('FlowTrackOffline');
    
    // Version 4: Updated schema for offline queue
    this.version(4).stores({
      readingsQueue: '++id, clientId, tenantId, customerId, readingDate, idempotencyKey, synced, priority, [tenantId+synced], [tenantId+customerId+readingDate]',
      photos: 'id, createdAt, mime',
      pendingPhotos: 'reading_id, tenant_id, timestamp'
    });
  }

  // Helper method to clear old synced data
  async clearSyncedReadings(olderThanDays = 7): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffISO = cutoffDate.toISOString();

    await this.readingsQueue
      .where('synced').equals(true)
      .and(item => item.lastSyncAttempt && item.lastSyncAttempt < cutoffISO)
      .delete();
  }

  // Helper method to get pending readings
  async getPendingReadings(tenantId: string): Promise<ReadingQueueItem[]> {
    return await this.readingsQueue
      .where('[tenantId+synced]')
      .equals([tenantId, false])
      .toArray();
  }

  // Helper method to mark reading as synced
  async markReadingAsSynced(id: number, serverId?: string): Promise<void> {
    await this.readingsQueue.update(id, {
      synced: true,
      serverId,
      lastSyncAttempt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncError: null
    });
  }

  // Helper method to increment sync attempts
  async incrementSyncAttempts(id: number, error?: string): Promise<void> {
    const reading = await this.readingsQueue.get(id);
    if (reading) {
      await this.readingsQueue.update(id, {
        syncAttempts: (reading.syncAttempts || 0) + 1,
        lastSyncAttempt: new Date().toISOString(),
        syncError: error || null,
        updatedAt: new Date().toISOString()
      });
    }
  }

  // Helper method to add reading to queue
  async queueReading(reading: Omit<ReadingQueueItem, 'id' | 'createdAt' | 'updatedAt' | 'syncAttempts' | 'synced' | 'lastSyncAttempt' | 'syncError'>): Promise<number> {
    const now = new Date().toISOString();
    return await this.readingsQueue.add({
      ...reading,
      createdAt: now,
      updatedAt: now,
      syncAttempts: 0,
      lastSyncAttempt: null,
      syncError: null,
      synced: false
    });
  }

  // Helper method to save photo blob
  async savePhoto(blob: Blob, id?: string): Promise<string> {
    const photoId = id || crypto.randomUUID();
    await this.photos.add({
      id: photoId,
      blob,
      createdAt: new Date().toISOString(),
      size: blob.size,
      mime: blob.type
    });
    return photoId;
  }

  // Helper method to get photo by ID
  async getPhoto(id: string): Promise<PhotoBlob | undefined> {
    return await this.photos.get(id);
  }

  // Helper method to delete photo
  async deletePhoto(id: string): Promise<void> {
    await this.photos.delete(id);
  }

  // Helper method to clean up old photos
  async cleanupOldPhotos(olderThanDays = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffISO = cutoffDate.toISOString();

    await this.photos
      .where('createdAt')
      .below(cutoffISO)
      .delete();
  }
}

// Create singleton instance
export const db = new OfflineDatabase();

// Open database connection
if (typeof window !== 'undefined') {
  db.open().catch(err => {
    console.error('Failed to open offline database:', err);
  });
}

// Export types for use in other modules
export type { ReadingQueueItem, PhotoBlob };