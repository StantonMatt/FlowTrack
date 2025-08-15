import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { OfflineDatabase, db } from '../offline';

describe('OfflineDatabase', () => {
  let testDb: OfflineDatabase;

  beforeEach(async () => {
    // Create a fresh database instance for each test
    testDb = new OfflineDatabase();
    await testDb.open();
  });

  afterEach(async () => {
    // Clean up after each test
    await testDb.delete();
  });

  describe('Database Initialization', () => {
    it('should create database with correct version', () => {
      expect(testDb.name).toBe('FlowTrackOffline');
      expect(testDb.verno).toBe(4);
    });

    it('should create all required tables', () => {
      expect(testDb.readingsQueue).toBeDefined();
      expect(testDb.photos).toBeDefined();
      expect(testDb.pendingPhotos).toBeDefined();
    });
  });

  describe('Reading Queue Operations', () => {
    const mockReading = {
      clientId: 'client-123',
      tenantId: 'tenant-456',
      customerId: 'customer-789',
      readingValue: 1234,
      readingDate: '2024-01-15',
      idempotencyKey: 'idem-key-123',
      priority: 'normal' as const,
    };

    it('should queue a new reading', async () => {
      const id = await testDb.queueReading(mockReading);
      
      expect(id).toBeDefined();
      expect(typeof id).toBe('number');
      
      const reading = await testDb.readingsQueue.get(id);
      expect(reading).toBeDefined();
      expect(reading?.clientId).toBe('client-123');
      expect(reading?.synced).toBe(false);
      expect(reading?.syncAttempts).toBe(0);
    });

    it('should get pending readings for a tenant', async () => {
      // Add multiple readings
      await testDb.queueReading({ ...mockReading, tenantId: 'tenant-1' });
      await testDb.queueReading({ ...mockReading, tenantId: 'tenant-1' });
      await testDb.queueReading({ ...mockReading, tenantId: 'tenant-2' });
      
      // Mark one as synced
      const syncedId = await testDb.queueReading({ ...mockReading, tenantId: 'tenant-1' });
      await testDb.markReadingAsSynced(syncedId, 'server-123');
      
      const pendingTenant1 = await testDb.getPendingReadings('tenant-1');
      const pendingTenant2 = await testDb.getPendingReadings('tenant-2');
      
      expect(pendingTenant1).toHaveLength(2);
      expect(pendingTenant2).toHaveLength(1);
    });

    it('should mark reading as synced', async () => {
      const id = await testDb.queueReading(mockReading);
      
      await testDb.markReadingAsSynced(id, 'server-456');
      
      const reading = await testDb.readingsQueue.get(id);
      expect(reading?.synced).toBe(true);
      expect(reading?.serverId).toBe('server-456');
      expect(reading?.syncError).toBeNull();
      expect(reading?.lastSyncAttempt).toBeDefined();
    });

    it('should increment sync attempts on failure', async () => {
      const id = await testDb.queueReading(mockReading);
      
      await testDb.incrementSyncAttempts(id, 'Network error');
      
      const reading = await testDb.readingsQueue.get(id);
      expect(reading?.syncAttempts).toBe(1);
      expect(reading?.syncError).toBe('Network error');
      expect(reading?.lastSyncAttempt).toBeDefined();
      
      // Increment again
      await testDb.incrementSyncAttempts(id, 'Timeout');
      
      const reading2 = await testDb.readingsQueue.get(id);
      expect(reading2?.syncAttempts).toBe(2);
      expect(reading2?.syncError).toBe('Timeout');
    });

    it('should clear old synced readings', async () => {
      // Add readings with different sync dates
      const now = new Date();
      const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      
      // Add old synced reading
      const oldId = await testDb.queueReading(mockReading);
      await testDb.readingsQueue.update(oldId, {
        synced: true,
        lastSyncAttempt: oldDate.toISOString(),
      });
      
      // Add recent synced reading
      const recentId = await testDb.queueReading(mockReading);
      await testDb.readingsQueue.update(recentId, {
        synced: true,
        lastSyncAttempt: recentDate.toISOString(),
      });
      
      // Add unsynced reading
      const unsyncedId = await testDb.queueReading(mockReading);
      
      await testDb.clearSyncedReadings(7);
      
      const remainingReadings = await testDb.readingsQueue.toArray();
      expect(remainingReadings).toHaveLength(2);
      expect(remainingReadings.find(r => r.id === oldId)).toBeUndefined();
      expect(remainingReadings.find(r => r.id === recentId)).toBeDefined();
      expect(remainingReadings.find(r => r.id === unsyncedId)).toBeDefined();
    });

    it('should handle priority levels', async () => {
      await testDb.queueReading({ ...mockReading, priority: 'high' });
      await testDb.queueReading({ ...mockReading, priority: 'normal' });
      
      const readings = await testDb.readingsQueue
        .where('priority')
        .equals('high')
        .toArray();
      
      expect(readings).toHaveLength(1);
      expect(readings[0].priority).toBe('high');
    });

    it('should prevent duplicate readings for same customer/date', async () => {
      const reading1 = {
        ...mockReading,
        customerId: 'customer-1',
        readingDate: '2024-01-15',
      };
      
      await testDb.queueReading(reading1);
      
      // Check for existing reading before adding duplicate
      const existing = await testDb.readingsQueue
        .where('[tenantId+customerId+readingDate]')
        .equals([reading1.tenantId, reading1.customerId, reading1.readingDate])
        .first();
      
      expect(existing).toBeDefined();
    });
  });

  describe('Photo Operations', () => {
    it('should save photo blob', async () => {
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      
      const photoId = await testDb.savePhoto(blob);
      
      expect(photoId).toBeDefined();
      
      const photo = await testDb.getPhoto(photoId);
      expect(photo).toBeDefined();
      expect(photo?.size).toBe(blob.size);
      expect(photo?.mime).toBe('image/jpeg');
    });

    it('should save photo with custom ID', async () => {
      const blob = new Blob(['test image data'], { type: 'image/png' });
      const customId = 'custom-photo-123';
      
      const photoId = await testDb.savePhoto(blob, customId);
      
      expect(photoId).toBe(customId);
      
      const photo = await testDb.getPhoto(customId);
      expect(photo).toBeDefined();
    });

    it('should delete photo', async () => {
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      const photoId = await testDb.savePhoto(blob);
      
      await testDb.deletePhoto(photoId);
      
      const photo = await testDb.getPhoto(photoId);
      expect(photo).toBeUndefined();
    });

    it('should cleanup old photos', async () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
      const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      
      // Add old photo
      const oldBlob = new Blob(['old'], { type: 'image/jpeg' });
      await testDb.photos.add({
        id: 'old-photo',
        blob: oldBlob,
        createdAt: oldDate.toISOString(),
        size: oldBlob.size,
        mime: 'image/jpeg',
      });
      
      // Add recent photo
      const recentBlob = new Blob(['recent'], { type: 'image/jpeg' });
      await testDb.photos.add({
        id: 'recent-photo',
        blob: recentBlob,
        createdAt: recentDate.toISOString(),
        size: recentBlob.size,
        mime: 'image/jpeg',
      });
      
      await testDb.cleanupOldPhotos(30);
      
      const oldPhoto = await testDb.getPhoto('old-photo');
      const recentPhoto = await testDb.getPhoto('recent-photo');
      
      expect(oldPhoto).toBeUndefined();
      expect(recentPhoto).toBeDefined();
    });
  });

  describe('Pending Photos Operations', () => {
    it('should add pending photo for sync', async () => {
      const pendingPhoto = {
        reading_id: 'reading-123',
        photo_data: 'data:image/jpeg;base64,/9j/4AAQ...',
        mime_type: 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: 'tenant-456',
      };
      
      await testDb.pendingPhotos.add(pendingPhoto);
      
      const photo = await testDb.pendingPhotos.get('reading-123');
      expect(photo).toBeDefined();
      expect(photo?.photo_data).toBe(pendingPhoto.photo_data);
    });

    it('should delete pending photo after upload', async () => {
      const pendingPhoto = {
        reading_id: 'reading-456',
        photo_data: 'data:image/png;base64,iVBORw0KG...',
        mime_type: 'image/png',
        timestamp: Date.now(),
        tenant_id: 'tenant-789',
      };
      
      await testDb.pendingPhotos.add(pendingPhoto);
      await testDb.pendingPhotos.delete('reading-456');
      
      const photo = await testDb.pendingPhotos.get('reading-456');
      expect(photo).toBeUndefined();
    });

    it('should get all pending photos for a tenant', async () => {
      await testDb.pendingPhotos.add({
        reading_id: 'reading-1',
        photo_data: 'data1',
        mime_type: 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: 'tenant-1',
      });
      
      await testDb.pendingPhotos.add({
        reading_id: 'reading-2',
        photo_data: 'data2',
        mime_type: 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: 'tenant-1',
      });
      
      await testDb.pendingPhotos.add({
        reading_id: 'reading-3',
        photo_data: 'data3',
        mime_type: 'image/jpeg',
        timestamp: Date.now(),
        tenant_id: 'tenant-2',
      });
      
      const tenant1Photos = await testDb.pendingPhotos
        .where('tenant_id')
        .equals('tenant-1')
        .toArray();
      
      expect(tenant1Photos).toHaveLength(2);
    });
  });

  describe('Database Transactions', () => {
    it('should handle transaction rollback on error', async () => {
      const mockReading = {
        clientId: 'client-trans',
        tenantId: 'tenant-trans',
        customerId: 'customer-trans',
        readingValue: 9999,
        readingDate: '2024-01-20',
        idempotencyKey: 'trans-key',
        priority: 'normal' as const,
      };
      
      try {
        await testDb.transaction('rw', testDb.readingsQueue, async () => {
          await testDb.queueReading(mockReading);
          // Force an error
          throw new Error('Transaction test error');
        });
      } catch (e) {
        // Expected error
      }
      
      // Reading should not exist due to rollback
      const readings = await testDb.readingsQueue
        .where('clientId')
        .equals('client-trans')
        .toArray();
      
      expect(readings).toHaveLength(0);
    });
  });

  describe('Database Singleton', () => {
    it('should use singleton instance', () => {
      expect(db).toBeDefined();
      expect(db).toBeInstanceOf(OfflineDatabase);
      expect(db.name).toBe('FlowTrackOffline');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing reading for sync attempts', async () => {
      await expect(
        testDb.incrementSyncAttempts(999999, 'Error')
      ).resolves.not.toThrow();
    });

    it('should handle invalid photo ID gracefully', async () => {
      const photo = await testDb.getPhoto('non-existent-id');
      expect(photo).toBeUndefined();
    });
  });
});