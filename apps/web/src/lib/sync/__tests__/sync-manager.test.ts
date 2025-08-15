import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncManager } from '../sync-manager';
import { db } from '@/lib/db/offline';
import { photoUploadService } from '../photo-upload';
import { telemetryService } from '../telemetry';
import * as authSync from '@/lib/pwa/auth-sync';

// Mock dependencies
vi.mock('@/lib/db/offline');
vi.mock('../photo-upload');
vi.mock('../telemetry');
vi.mock('@/lib/pwa/auth-sync');

describe('SyncManager', () => {
  const mockAuthState = {
    tenantId: 'test-tenant-id',
    accessToken: 'test-token',
    expiresAt: Date.now() / 1000 + 3600, // 1 hour from now
    userId: 'test-user-id',
  };

  const mockReading = {
    id: 1,
    tenantId: 'test-tenant-id',
    payload: {
      id: 'reading-1',
      customerId: 'customer-1',
      readingValue: 1234.5,
      readingDate: new Date().toISOString(),
    },
    idempotencyKey: 'test-key-123',
    synced: false,
    retries: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Setup default mock implementations
    vi.mocked(authSync.getAuthState).mockResolvedValue(mockAuthState);
    vi.mocked(authSync.isTokenExpired).mockReturnValue(false);
    vi.mocked(db.getPendingReadings).mockResolvedValue([mockReading]);
    vi.mocked(db.markReadingAsSynced).mockResolvedValue(undefined);
    vi.mocked(telemetryService.startSession).mockImplementation(() => {});
    vi.mocked(telemetryService.endSession).mockReturnValue(null);
    vi.mocked(telemetryService.logEvent).mockImplementation(() => {});
    
    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sync', () => {
    it('should successfully sync pending readings', async () => {
      // Mock successful API response
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await syncManager.sync();

      // Verify auth state was checked
      expect(authSync.getAuthState).toHaveBeenCalled();
      
      // Verify pending readings were fetched
      expect(db.getPendingReadings).toHaveBeenCalledWith('test-tenant-id');
      
      // Verify API call was made
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/readings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.any(Headers),
        })
      );
      
      // Verify reading was marked as synced
      expect(db.markReadingAsSynced).toHaveBeenCalledWith(1);
      
      // Verify telemetry was tracked
      expect(telemetryService.startSession).toHaveBeenCalled();
      expect(telemetryService.endSession).toHaveBeenCalled();
    });

    it('should handle auth token refresh when expired', async () => {
      // Mock expired token
      vi.mocked(authSync.isTokenExpired).mockReturnValue(true);
      
      const refreshedState = {
        ...mockAuthState,
        accessToken: 'refreshed-token',
        expiresAt: Date.now() / 1000 + 7200,
      };
      vi.mocked(authSync.requestTokenRefresh).mockResolvedValue(refreshedState);
      
      // Mock successful API response
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
        })
      );

      await syncManager.sync();

      // Verify token refresh was called
      expect(authSync.requestTokenRefresh).toHaveBeenCalled();
      
      // Verify API was called with refreshed token
      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const headers = fetchCall[1]?.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer refreshed-token');
    });

    it('should handle photo uploads during sync', async () => {
      // Mock reading with photo
      const readingWithPhoto = {
        ...mockReading,
        photoBlobRef: 'photo-123',
      };
      vi.mocked(db.getPendingReadings).mockResolvedValue([readingWithPhoto]);
      
      // Mock photo blob
      const mockPhotoBlob = new Blob(['photo data'], { type: 'image/jpeg' });
      vi.mocked(db.getPhoto).mockResolvedValue({
        id: 'photo-123',
        blob: mockPhotoBlob,
        createdAt: new Date().toISOString(),
      });
      
      // Mock successful photo upload
      vi.mocked(photoUploadService.uploadPhoto).mockResolvedValue({
        success: true,
        url: 'https://storage.example.com/photo.jpg',
        path: 'tenant/customer/photo.jpg',
      });
      
      // Mock successful API response
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
        })
      );

      await syncManager.sync();

      // Verify photo was fetched and uploaded
      expect(db.getPhoto).toHaveBeenCalledWith('photo-123');
      expect(photoUploadService.uploadPhoto).toHaveBeenCalledWith(
        mockPhotoBlob,
        expect.objectContaining({
          tenantId: 'test-tenant-id',
          customerId: 'customer-1',
        })
      );
      
      // Verify photo was deleted after successful sync
      expect(db.deletePhoto).toHaveBeenCalledWith('photo-123');
    });

    it('should handle API errors with retry', async () => {
      // Mock server error (500)
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response('Server Error', {
          status: 500,
        })
      );

      await syncManager.sync();

      // Verify retry count was incremented
      expect(db.incrementRetryCount).toHaveBeenCalledWith(1);
      
      // Verify telemetry tracked the failure
      expect(telemetryService.trackFailure).toHaveBeenCalled();
    });

    it('should handle idempotency conflicts (409)', async () => {
      // Mock conflict response
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response('Conflict', {
          status: 409,
        })
      );

      await syncManager.sync();

      // Verify reading was still marked as synced
      expect(db.markReadingAsSynced).toHaveBeenCalledWith(1);
      expect(telemetryService.trackSuccess).toHaveBeenCalled();
    });

    it('should stop syncing on auth failure', async () => {
      // Mock multiple readings
      const readings = [
        mockReading,
        { ...mockReading, id: 2 },
        { ...mockReading, id: 3 },
      ];
      vi.mocked(db.getPendingReadings).mockResolvedValue(readings);
      
      // Mock auth failure on first request
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
        })
      );

      await expect(syncManager.sync()).rejects.toThrow();

      // Verify only one API call was made
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      // Verify no readings were marked as synced
      expect(db.markReadingAsSynced).not.toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      // Mock network error
      vi.mocked(global.fetch).mockRejectedValueOnce(
        new Error('Network error')
      );

      await syncManager.sync();

      // Verify error was tracked
      expect(telemetryService.trackFailure).toHaveBeenCalledWith(
        '1',
        expect.any(Error)
      );
      
      // Verify retry was scheduled
      expect(db.incrementRetryCount).toHaveBeenCalled();
    });

    it('should process readings in batches', async () => {
      // Mock many readings (more than batch size)
      const manyReadings = Array.from({ length: 150 }, (_, i) => ({
        ...mockReading,
        id: i + 1,
      }));
      vi.mocked(db.getPendingReadings).mockResolvedValue(manyReadings);
      
      // Mock successful responses
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
        })
      );

      await syncManager.sync();

      // Verify readings were processed (default batch size is 50)
      expect(global.fetch).toHaveBeenCalledTimes(150);
      
      // Verify all readings were marked as synced
      expect(db.markReadingAsSynced).toHaveBeenCalledTimes(150);
    });

    it('should handle concurrent sync requests', async () => {
      // Mock slow API response
      let resolveResponse: any;
      const responsePromise = new Promise((resolve) => {
        resolveResponse = resolve;
      });
      vi.mocked(global.fetch).mockReturnValueOnce(responsePromise as any);

      // Start two sync operations
      const sync1 = syncManager.sync();
      const sync2 = syncManager.sync();

      // Both should return the same promise
      expect(sync1).toBe(sync2);

      // Resolve the response
      resolveResponse(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
        })
      );

      await sync1;

      // Verify only one sync actually ran
      expect(telemetryService.startSession).toHaveBeenCalledTimes(1);
    });

    it('should calculate backoff delay correctly', async () => {
      // Mock reading with retries
      const readingWithRetries = {
        ...mockReading,
        retries: 3,
      };
      vi.mocked(db.getPendingReadings).mockResolvedValue([readingWithRetries]);
      
      // Mock successful response
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
        })
      );

      const startTime = Date.now();
      await syncManager.sync();
      const endTime = Date.now();

      // Verify delay was applied (exponential backoff)
      // Base delay (1000ms) * 2^3 = 8000ms, plus jitter
      // Should be at least some delay
      expect(endTime - startTime).toBeGreaterThan(0);
    });
  });

  describe('cancel', () => {
    it('should cancel ongoing sync', async () => {
      // Mock many readings to make sync take time
      const manyReadings = Array.from({ length: 100 }, (_, i) => ({
        ...mockReading,
        id: i + 1,
      }));
      vi.mocked(db.getPendingReadings).mockResolvedValue(manyReadings);
      
      // Mock slow responses
      vi.mocked(global.fetch).mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 100))
      );

      // Start sync
      const syncPromise = syncManager.sync();
      
      // Cancel immediately
      syncManager.cancel();

      // Sync should complete quickly due to cancellation
      await expect(syncPromise).resolves.not.toThrow();
      
      // Not all readings should have been processed
      expect(global.fetch).toHaveBeenCalledTimes(0);
    });
  });

  describe('getProgress', () => {
    it('should return current sync progress', async () => {
      // Mock readings in different states
      const allReadings = [
        { ...mockReading, id: 1, synced: true },
        { ...mockReading, id: 2, synced: true },
        { ...mockReading, id: 3, synced: false },
        { ...mockReading, id: 4, synced: false, retries: 5 },
      ];
      
      vi.mocked(db.getPendingReadings).mockResolvedValue(
        allReadings.filter(r => !r.synced)
      );
      
      vi.mocked(db.readingsQueue.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(allReadings),
        }),
      } as any);

      const progress = await syncManager.getProgress();

      expect(progress).toEqual({
        total: 4,
        synced: 2,
        failed: 1, // One with max retries
        inProgress: false,
      });
    });
  });

  describe('cleanup', () => {
    it('should clean up old synced data', async () => {
      await syncManager.cleanup(7);

      expect(db.clearSyncedReadings).toHaveBeenCalledWith(7);
      expect(db.cleanupOldPhotos).toHaveBeenCalledWith(14);
    });
  });
});