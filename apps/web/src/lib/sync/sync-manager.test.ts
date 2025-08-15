import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { syncManager } from './sync-manager';
import { db } from '@/lib/db/offline';
import * as authSync from '@/lib/pwa/auth-sync';

// Mock fetch
global.fetch = vi.fn();

// Mock auth functions
vi.mock('@/lib/pwa/auth-sync', () => ({
  getAuthState: vi.fn(),
  isTokenExpired: vi.fn(),
  requestTokenRefresh: vi.fn(),
}));

describe('SyncManager', () => {
  const mockAuthState = {
    accessToken: 'test-token',
    refreshToken: 'refresh-token',
    tenantId: 'tenant-123',
    userId: 'user-456',
    expiresAt: Date.now() / 1000 + 3600, // 1 hour from now
  };

  beforeEach(async () => {
    await db.open();
    vi.clearAllMocks();
    (authSync.getAuthState as any).mockResolvedValue(mockAuthState);
    (authSync.isTokenExpired as any).mockReturnValue(false);
  });

  afterEach(async () => {
    await db.readingsQueue.clear();
    await db.photos.clear();
    syncManager.cancel();
  });

  describe('sync operation', () => {
    it('should sync pending readings', async () => {
      // Add test readings
      await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z',
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-123',
        idempotencyKey: 'key-1',
      });

      // Mock successful API response
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Perform sync
      await syncManager.sync();

      // Verify API call
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/readings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.any(Headers),
        })
      );

      // Verify reading marked as synced
      const readings = await db.readingsQueue.toArray();
      expect(readings[0].synced).toBe(true);
      expect(readings[0].syncedAt).toBeDefined();
    });

    it('should handle auth token expiration', async () => {
      // Mock expired token
      (authSync.isTokenExpired as any).mockReturnValue(true);
      (authSync.requestTokenRefresh as any).mockResolvedValue({
        ...mockAuthState,
        accessToken: 'new-token',
      });

      await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z',
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-123',
        idempotencyKey: 'key-1',
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await syncManager.sync();

      // Verify token refresh was called
      expect(authSync.requestTokenRefresh).toHaveBeenCalled();
    });

    it('should handle idempotency conflicts', async () => {
      await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z',
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-123',
        idempotencyKey: 'duplicate-key',
      });

      // Mock 409 Conflict response
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 409,
      });

      await syncManager.sync();

      // Should still mark as synced
      const readings = await db.readingsQueue.toArray();
      expect(readings[0].synced).toBe(true);
    });

    it('should retry on server errors', async () => {
      const reading = await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z',
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-123',
        idempotencyKey: 'key-1',
      });

      // Mock 500 server error
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await syncManager.sync();

      // Verify retry count incremented
      const updatedReading = await db.readingsQueue.get(reading);
      expect(updatedReading?.retries).toBe(1);
      expect(updatedReading?.synced).toBe(false);
    });

    it('should process batches correctly', async () => {
      // Add multiple readings
      for (let i = 0; i < 10; i++) {
        await db.queueReading({
          payload: {
            customerId: `cust-${i}`,
            meterId: `meter-${i}`,
            reading: 100 + i,
            readingDate: '2024-01-15T10:00:00Z',
          },
          readingDate: '2024-01-15T10:00:00Z',
          tenantId: 'tenant-123',
          idempotencyKey: `key-${i}`,
        });
      }

      // Mock successful responses
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      await syncManager.sync();

      // Verify all readings synced
      const readings = await db.readingsQueue.toArray();
      expect(readings.every(r => r.synced)).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(10);
    });
  });

  describe('progress tracking', () => {
    it('should emit progress events', async () => {
      const progressEvents: any[] = [];
      const completeEvents: any[] = [];

      syncManager.on('progress', (p) => progressEvents.push(p));
      syncManager.on('complete', (p) => completeEvents.push(p));

      await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z',
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-123',
        idempotencyKey: 'key-1',
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await syncManager.sync();

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(completeEvents.length).toBe(1);
      expect(completeEvents[0].synced).toBe(1);
    });

    it('should get current progress', async () => {
      await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z',
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-123',
        idempotencyKey: 'key-1',
      });

      const progress = await syncManager.getProgress();
      expect(progress.total).toBe(1);
      expect(progress.synced).toBe(0);
      expect(progress.failed).toBe(0);
    });
  });

  describe('concurrency control', () => {
    it('should prevent concurrent syncs', async () => {
      await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z',
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-123',
        idempotencyKey: 'key-1',
      });

      let callCount = 0;
      (global.fetch as any).mockImplementation(() => {
        callCount++;
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({ ok: true, status: 200 });
          }, 100);
        });
      });

      // Start multiple syncs
      const sync1 = syncManager.sync();
      const sync2 = syncManager.sync();
      const sync3 = syncManager.sync();

      await Promise.all([sync1, sync2, sync3]);

      // Should only make one API call
      expect(callCount).toBe(1);
    });

    it('should cancel ongoing sync', async () => {
      await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z',
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-123',
        idempotencyKey: 'key-1',
      });

      (global.fetch as any).mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ ok: true, status: 200 });
          }, 1000);
        });
      });

      const syncPromise = syncManager.sync();
      
      // Cancel after short delay
      setTimeout(() => syncManager.cancel(), 50);

      await expect(syncPromise).resolves.toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should clean up old synced readings', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      // Add old synced reading
      await db.readingsQueue.add({
        payload: {
          customerId: 'cust-old',
          meterId: 'meter-old',
          reading: 100,
          readingDate: oldDate.toISOString(),
        },
        readingDate: oldDate.toISOString(),
        createdAt: oldDate.toISOString(),
        updatedAt: oldDate.toISOString(),
        retries: 0,
        synced: true,
        syncedAt: oldDate.toISOString(),
        tenantId: 'tenant-123',
        idempotencyKey: 'old-key',
      });

      // Add recent reading
      await db.queueReading({
        payload: {
          customerId: 'cust-new',
          meterId: 'meter-new',
          reading: 200,
          readingDate: new Date().toISOString(),
        },
        readingDate: new Date().toISOString(),
        tenantId: 'tenant-123',
        idempotencyKey: 'new-key',
      });

      await syncManager.cleanup(7);

      const readings = await db.readingsQueue.toArray();
      expect(readings).toHaveLength(1);
      expect(readings[0].payload.customerId).toBe('cust-new');
    });
  });
});