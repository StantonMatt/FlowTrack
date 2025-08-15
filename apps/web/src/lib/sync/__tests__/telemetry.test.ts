import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { telemetryService } from '../telemetry';

describe('TelemetryService', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    sessionStorage.clear();
    
    // Mock fetch
    global.fetch = vi.fn();
    
    // Mock navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('session management', () => {
    it('should start and end a telemetry session', () => {
      telemetryService.startSession();
      
      // Track some events
      telemetryService.trackAttempt('item-1', { hasPhoto: true });
      telemetryService.trackSuccess('item-1', { photoUploaded: true });
      
      const telemetry = telemetryService.endSession();
      
      expect(telemetry).toMatchObject({
        timestamp: expect.any(Date),
        duration: expect.any(Number),
        totalItems: 1,
        successCount: 1,
        failureCount: 0,
        photoUploads: 1,
        photoUploadFailures: 0,
      });
    });

    it('should track multiple items in a session', () => {
      telemetryService.startSession();
      
      // Track multiple items
      telemetryService.trackAttempt('item-1', { hasPhoto: true });
      telemetryService.trackSuccess('item-1', { photoUploaded: true });
      
      telemetryService.trackAttempt('item-2', { hasPhoto: false });
      telemetryService.trackSuccess('item-2');
      
      telemetryService.trackAttempt('item-3', { hasPhoto: true });
      telemetryService.trackFailure('item-3', 'Network error');
      
      const telemetry = telemetryService.endSession();
      
      expect(telemetry).toMatchObject({
        totalItems: 3,
        successCount: 2,
        failureCount: 1,
        photoUploads: 1,
        photoUploadFailures: 1,
      });
    });

    it('should calculate average retries correctly', () => {
      telemetryService.startSession();
      
      // Track items with retries
      telemetryService.trackAttempt('item-1', { isRetry: false });
      telemetryService.trackAttempt('item-1', { isRetry: true });
      telemetryService.trackAttempt('item-1', { isRetry: true });
      telemetryService.trackSuccess('item-1');
      
      telemetryService.trackAttempt('item-2', { isRetry: false });
      telemetryService.trackSuccess('item-2');
      
      const telemetry = telemetryService.endSession();
      
      expect(telemetry?.averageRetries).toBe(2); // (3 + 1) / 2 = 2
      expect(telemetry?.retryCount).toBe(2); // 2 retries total
    });

    it('should return null if no session is active', () => {
      const telemetry = telemetryService.endSession();
      expect(telemetry).toBeNull();
    });
  });

  describe('error categorization', () => {
    it('should categorize different error types', () => {
      telemetryService.startSession();
      
      telemetryService.trackFailure('item-1', 'Error 401: Unauthorized');
      telemetryService.trackFailure('item-2', 'Network timeout');
      telemetryService.trackFailure('item-3', 'Server error 500');
      telemetryService.trackFailure('item-4', 'Storage quota exceeded');
      telemetryService.trackFailure('item-5', 'Conflict 409');
      telemetryService.trackFailure('item-6', 'Unknown error occurred');
      
      const telemetry = telemetryService.endSession();
      
      expect(telemetry?.errors).toContainEqual(
        expect.objectContaining({ type: 'Authentication Error' })
      );
      expect(telemetry?.errors).toContainEqual(
        expect.objectContaining({ type: 'Timeout Error' })
      );
      expect(telemetry?.errors).toContainEqual(
        expect.objectContaining({ type: 'Server Error' })
      );
      expect(telemetry?.errors).toContainEqual(
        expect.objectContaining({ type: 'Storage Error' })
      );
      expect(telemetry?.errors).toContainEqual(
        expect.objectContaining({ type: 'Conflict Error' })
      );
      expect(telemetry?.errors).toContainEqual(
        expect.objectContaining({ type: 'Unknown Error' })
      );
    });
  });

  describe('telemetry storage', () => {
    it('should store telemetry in localStorage', () => {
      telemetryService.startSession();
      telemetryService.trackAttempt('item-1');
      telemetryService.trackSuccess('item-1');
      telemetryService.endSession();
      
      const stored = localStorage.getItem('sync_telemetry_history');
      expect(stored).toBeTruthy();
      
      const history = JSON.parse(stored!);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        totalItems: 1,
        successCount: 1,
      });
    });

    it('should limit history to 100 entries', () => {
      // Create 101 sessions
      for (let i = 0; i < 101; i++) {
        telemetryService.startSession();
        telemetryService.trackAttempt(`item-${i}`);
        telemetryService.trackSuccess(`item-${i}`);
        telemetryService.endSession();
      }
      
      const stored = localStorage.getItem('sync_telemetry_history');
      const history = JSON.parse(stored!);
      
      expect(history).toHaveLength(100);
    });

    it('should send telemetry to server when online', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response('OK', { status: 200 })
      );
      
      telemetryService.startSession();
      telemetryService.trackAttempt('item-1');
      telemetryService.trackSuccess('item-1');
      telemetryService.endSession();
      
      // Wait for async send
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/telemetry',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should not send telemetry when offline', async () => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });
      
      telemetryService.startSession();
      telemetryService.trackAttempt('item-1');
      telemetryService.trackSuccess('item-1');
      telemetryService.endSession();
      
      // Wait to ensure no async calls
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('metrics aggregation', () => {
    it('should calculate aggregated metrics', async () => {
      // Create multiple sessions
      for (let i = 0; i < 5; i++) {
        telemetryService.startSession();
        telemetryService.trackAttempt(`item-${i}`, { hasPhoto: i % 2 === 0 });
        telemetryService.trackSuccess(`item-${i}`, { photoUploaded: i % 2 === 0 });
        telemetryService.endSession();
      }
      
      const metrics = await telemetryService.getMetrics();
      
      expect(metrics).toMatchObject({
        totalSyncs: 5,
        successfulSyncs: 5,
        failedSyncs: 0,
        totalDataSynced: 5,
        totalPhotosSynced: 3, // 0, 2, 4
      });
      expect(metrics.averageDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.averageItemsPerSync).toBe(1);
    });

    it('should handle empty history', async () => {
      const metrics = await telemetryService.getMetrics();
      
      expect(metrics).toEqual({
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        averageDuration: 0,
        averageItemsPerSync: 0,
        totalDataSynced: 0,
        totalPhotosSynced: 0,
      });
    });
  });

  describe('event logging', () => {
    it('should log events to session storage', () => {
      telemetryService.logEvent('test_event', { data: 'test' });
      
      const logs = sessionStorage.getItem('sync_logs');
      expect(logs).toBeTruthy();
      
      const parsed = JSON.parse(logs!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        timestamp: expect.any(String),
        event: 'test_event',
        data: { data: 'test' },
      });
    });

    it('should limit logs to 100 entries', () => {
      for (let i = 0; i < 105; i++) {
        telemetryService.logEvent(`event_${i}`);
      }
      
      const logs = sessionStorage.getItem('sync_logs');
      const parsed = JSON.parse(logs!);
      
      expect(parsed).toHaveLength(100);
    });

    it('should retrieve logs', () => {
      telemetryService.logEvent('event_1', { test: 1 });
      telemetryService.logEvent('event_2', { test: 2 });
      
      const logs = telemetryService.getLogs();
      
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({
        event: 'event_1',
        data: { test: 1 },
      });
    });
  });

  describe('network information', () => {
    it('should capture network type if available', () => {
      // Mock navigator.connection
      (navigator as any).connection = {
        effectiveType: '4g',
        downlink: 10,
      };
      
      telemetryService.startSession();
      telemetryService.trackAttempt('item-1');
      telemetryService.trackSuccess('item-1');
      const telemetry = telemetryService.endSession();
      
      expect(telemetry?.networkType).toBe('4g');
      expect(telemetry?.connectionSpeed).toBe(10);
    });

    it('should handle missing connection API', () => {
      // Remove connection API
      (navigator as any).connection = undefined;
      
      telemetryService.startSession();
      telemetryService.trackAttempt('item-1');
      telemetryService.trackSuccess('item-1');
      const telemetry = telemetryService.endSession();
      
      expect(telemetry?.networkType).toBeUndefined();
      expect(telemetry?.connectionSpeed).toBeUndefined();
    });
  });

  describe('clearHistory', () => {
    it('should clear telemetry history', () => {
      // Add some history
      telemetryService.startSession();
      telemetryService.trackAttempt('item-1');
      telemetryService.trackSuccess('item-1');
      telemetryService.endSession();
      
      expect(localStorage.getItem('sync_telemetry_history')).toBeTruthy();
      
      // Clear history
      telemetryService.clearHistory();
      
      expect(localStorage.getItem('sync_telemetry_history')).toBeNull();
    });
  });
});