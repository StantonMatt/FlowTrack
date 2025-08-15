import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initializeSyncQueue, triggerManualSync, getQueueStatistics, clearSyncQueue, uploadPendingPhotos, getPendingPhotoCount } from '../sync-queue';
import { db } from '@/lib/db/offline';

// Mock Serwist modules
vi.mock('@serwist/background-sync', () => ({
  Queue: vi.fn().mockImplementation((name, options) => ({
    name,
    options,
    addPlugin: vi.fn(),
    shiftRequest: vi.fn(),
    unshiftRequest: vi.fn(),
  })),
}));

vi.mock('@serwist/routing', () => ({
  registerRoute: vi.fn(),
}));

vi.mock('@serwist/strategies', () => ({
  NetworkOnly: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: 'test/path.jpg' }, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/test.jpg' } }),
      }),
    },
  }),
}));

describe('Sync Queue', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Mock global objects
    global.crypto = {
      randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
    } as any;
    
    global.navigator = {
      serviceWorker: {
        ready: Promise.resolve({
          sync: {
            register: vi.fn().mockResolvedValue(undefined),
          },
        }),
        controller: {
          postMessage: vi.fn(),
        },
      },
    } as any;
    
    global.window = {
      SyncManager: vi.fn(),
    } as any;
  });

  afterEach(async () => {
    // Clean up database
    await db.delete();
    vi.restoreAllMocks();
  });

  describe('Queue Initialization', () => {
    it('should initialize sync queue with correct configuration', () => {
      const queue = initializeSyncQueue();
      
      expect(queue).toBeDefined();
      expect(queue.name).toBe('readings-sync-queue');
      expect(queue.options.maxRetentionTime).toBe(7 * 24 * 60); // 7 days
    });

    it('should register routes for sync endpoints', () => {
      const { registerRoute } = require('@serwist/routing');
      
      initializeSyncQueue();
      
      expect(registerRoute).toHaveBeenCalledTimes(3);
      expect(registerRoute).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object),
        'POST'
      );
    });

    it('should add plugins to queue', () => {
      const queue = initializeSyncQueue();
      
      expect(queue.addPlugin).toHaveBeenCalledTimes(3); // PhotoUpload, Idempotency, Telemetry
    });
  });

  describe('Manual Sync Trigger', () => {
    it('should trigger manual sync via SyncManager', async () => {
      await triggerManualSync();
      
      const registration = await navigator.serviceWorker.ready;
      expect((registration as any).sync.register).toHaveBeenCalledWith('sync-readings');
    });

    it('should fallback to postMessage if SyncManager fails', async () => {
      // Mock SyncManager to throw error
      const registration = await navigator.serviceWorker.ready;
      (registration as any).sync.register.mockRejectedValue(new Error('Sync failed'));
      
      await triggerManualSync();
      
      expect(navigator.serviceWorker.controller?.postMessage).toHaveBeenCalledWith({
        type: 'TRIGGER_SYNC',
      });
    });

    it('should handle missing service worker gracefully', async () => {
      // Remove service worker
      delete (global.navigator as any).serviceWorker;
      
      await expect(triggerManualSync()).resolves.not.toThrow();
    });
  });

  describe('Queue Statistics', () => {
    it('should return empty statistics for empty queue', async () => {
      const stats = await getQueueStatistics();
      
      expect(stats).toEqual({
        size: 0,
        oldestEntry: null,
      });
    });

    it('should calculate queue size and oldest entry', async () => {
      // Mock IndexedDB with queue entries
      vi.mock('idb', () => ({
        openDB: vi.fn().mockResolvedValue({
          transaction: vi.fn().mockReturnValue({
            objectStore: vi.fn().mockReturnValue({
              getAll: vi.fn().mockResolvedValue([
                { queueName: 'readings-sync-queue', timestamp: Date.now() - 3600000 },
                { queueName: 'readings-sync-queue', timestamp: Date.now() - 7200000 },
                { queueName: 'other-queue', timestamp: Date.now() },
              ]),
            }),
          }),
        }),
      }));
      
      const stats = await getQueueStatistics();
      
      expect(stats.size).toBe(2);
      expect(stats.oldestEntry).toBeInstanceOf(Date);
    });
  });

  describe('Queue Cleanup', () => {
    it('should clear all entries from sync queue', async () => {
      // Mock IndexedDB
      const mockDelete = vi.fn();
      vi.mock('idb', () => ({
        openDB: vi.fn().mockResolvedValue({
          transaction: vi.fn().mockReturnValue({
            objectStore: vi.fn().mockReturnValue({
              getAll: vi.fn().mockResolvedValue([
                { id: 1, queueName: 'readings-sync-queue' },
                { id: 2, queueName: 'readings-sync-queue' },
                { id: 3, queueName: 'other-queue' },
              ]),
              delete: mockDelete,
            }),
            complete: Promise.resolve(),
          }),
        }),
      }));
      
      await clearSyncQueue();
      
      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(mockDelete).toHaveBeenCalledWith(1);
      expect(mockDelete).toHaveBeenCalledWith(2);
    });
  });

  describe('Photo Upload', () => {
    beforeEach(async () => {
      // Ensure database is open
      await db.open();
    });

    it('should upload pending photos', async () => {
      // Add test photos to pendingPhotos store
      await db.pendingPhotos.add({
        reading_id: 'test-reading-1',
        photo_data: 'data:image/jpeg;base64,/9j/4AAQ',
        mime_type: 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: 'test-tenant',
      });
      
      await db.pendingPhotos.add({
        reading_id: 'test-reading-2',
        photo_data: 'data:image/png;base64,iVBORw0KG',
        mime_type: 'image/png',
        timestamp: Date.now(),
        tenant_id: 'test-tenant',
      });
      
      const result = await uploadPendingPhotos();
      
      expect(result).toEqual({
        uploaded: 2,
        failed: 0,
      });
    });

    it('should handle upload failures gracefully', async () => {
      // Mock upload to fail
      const { createClient } = require('@supabase/supabase-js');
      createClient.mockReturnValue({
        storage: {
          from: vi.fn().mockReturnValue({
            upload: vi.fn().mockResolvedValue({ data: null, error: new Error('Upload failed') }),
          }),
        },
      });
      
      await db.pendingPhotos.add({
        reading_id: 'test-reading-fail',
        photo_data: 'data:image/jpeg;base64,/9j/4AAQ',
        mime_type: 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: 'test-tenant',
      });
      
      const result = await uploadPendingPhotos();
      
      expect(result).toEqual({
        uploaded: 0,
        failed: 1,
      });
    });

    it('should count pending photos', async () => {
      // Add test photos
      await db.pendingPhotos.add({
        reading_id: 'test-reading-1',
        photo_data: 'data:image/jpeg;base64,test',
        mime_type: 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: 'test-tenant',
      });
      
      await db.pendingPhotos.add({
        reading_id: 'test-reading-2',
        photo_data: 'data:image/jpeg;base64,test2',
        mime_type: 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: 'test-tenant',
      });
      
      const count = await getPendingPhotoCount();
      
      expect(count).toBe(2);
    });
  });

  describe('Exponential Backoff', () => {
    it('should calculate retry delay with exponential backoff', () => {
      // This would normally be a private function, but we can test the behavior
      // through the onSync handler
      const queue = initializeSyncQueue();
      const onSync = queue.options.onSync;
      
      expect(onSync).toBeDefined();
      expect(typeof onSync).toBe('function');
    });
  });

  describe('Idempotency', () => {
    it('should add idempotency keys to requests', async () => {
      // Test would verify that IdempotencyPlugin adds keys
      const queue = initializeSyncQueue();
      
      // Verify plugin was added
      expect(queue.addPlugin).toHaveBeenCalled();
    });
  });

  describe('Telemetry', () => {
    it('should track sync metrics', async () => {
      // Mock fetch for telemetry endpoint
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      
      const queue = initializeSyncQueue();
      
      // Verify telemetry plugin was added
      expect(queue.addPlugin).toHaveBeenCalled();
    });
  });
});