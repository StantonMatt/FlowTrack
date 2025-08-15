import Dexie, { type Table } from 'dexie';

export interface OfflineReading {
  id?: number;
  clientId: string;
  tenantId: string;
  customerId: string;
  readingValue: number;
  readingDate: string;
  metadata?: Record<string, any>;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
  createdAt: Date;
  syncedAt?: Date;
  serverReadingId?: string;
}

export interface SyncLog {
  id?: number;
  action: string;
  timestamp: Date;
  success: boolean;
  error?: string;
  details?: Record<string, any>;
}

export class FlowTrackDB extends Dexie {
  // Tables
  readings!: Table<OfflineReading>;
  syncLogs!: Table<SyncLog>;

  constructor() {
    super('FlowTrackDB');
    
    this.version(1).stores({
      readings: '++id, clientId, tenantId, customerId, status, createdAt, syncedAt',
      syncLogs: '++id, action, timestamp, success',
    });
  }

  // Helper methods
  async addOfflineReading(reading: Omit<OfflineReading, 'id' | 'createdAt'>): Promise<number> {
    return this.readings.add({
      ...reading,
      createdAt: new Date(),
    });
  }

  async getReadingsToSync(tenantId: string): Promise<OfflineReading[]> {
    return this.readings
      .where('tenantId')
      .equals(tenantId)
      .and((reading) => reading.status === 'pending' || reading.status === 'failed')
      .toArray();
  }

  async markAsSyncing(ids: number[]): Promise<void> {
    await this.readings
      .where('id')
      .anyOf(ids)
      .modify({ status: 'syncing' });
  }

  async markAsSynced(id: number, serverReadingId: string): Promise<void> {
    await this.readings.update(id, {
      status: 'synced',
      syncedAt: new Date(),
      serverReadingId,
      error: undefined,
    });
  }

  async markAsFailed(id: number, error: string): Promise<void> {
    await this.readings.update(id, {
      status: 'failed',
      error,
    });
  }

  async logSyncAttempt(
    action: string,
    success: boolean,
    error?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.syncLogs.add({
      action,
      timestamp: new Date(),
      success,
      error,
      details,
    });
  }

  async clearSyncedReadings(olderThan?: Date): Promise<void> {
    const cutoff = olderThan || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days default
    
    await this.readings
      .where('status')
      .equals('synced')
      .and((reading) => reading.syncedAt! < cutoff)
      .delete();
  }

  async getRecentSyncLogs(limit: number = 50): Promise<SyncLog[]> {
    return this.syncLogs
      .orderBy('timestamp')
      .reverse()
      .limit(limit)
      .toArray();
  }
}

// Export singleton instance
export const db = new FlowTrackDB();