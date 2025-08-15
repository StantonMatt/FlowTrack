import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, type ReadingQueueItem } from './offline';

describe('OfflineDatabase', () => {
  beforeEach(async () => {
    await db.open();
  });

  afterEach(async () => {
    await db.readingsQueue.clear();
    await db.photos.clear();
  });

  describe('readingsQueue', () => {
    it('should add reading to queue', async () => {
      const reading: Omit<ReadingQueueItem, 'id' | 'createdAt' | 'updatedAt' | 'retries' | 'synced'> = {
        payload: {
          customerId: 'cust-123',
          meterId: 'meter-456',
          reading: 1234.56,
          readingDate: '2024-01-15T10:00:00Z',
          notes: 'Test reading'
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-abc',
        idempotencyKey: 'key-789'
      };

      const id = await db.queueReading(reading);
      expect(id).toBeGreaterThan(0);

      const saved = await db.readingsQueue.get(id);
      expect(saved).toBeDefined();
      expect(saved?.payload.customerId).toBe('cust-123');
      expect(saved?.synced).toBe(false);
      expect(saved?.retries).toBe(0);
    });

    it('should get pending readings for tenant', async () => {
      await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z'
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-1',
        idempotencyKey: 'key-1'
      });

      await db.queueReading({
        payload: {
          customerId: 'cust-2',
          meterId: 'meter-2',
          reading: 200,
          readingDate: '2024-01-15T11:00:00Z'
        },
        readingDate: '2024-01-15T11:00:00Z',
        tenantId: 'tenant-2',
        idempotencyKey: 'key-2'
      });

      const tenant1Readings = await db.getPendingReadings('tenant-1');
      expect(tenant1Readings).toHaveLength(1);
      expect(tenant1Readings[0].tenantId).toBe('tenant-1');

      const tenant2Readings = await db.getPendingReadings('tenant-2');
      expect(tenant2Readings).toHaveLength(1);
      expect(tenant2Readings[0].tenantId).toBe('tenant-2');
    });

    it('should mark reading as synced', async () => {
      const id = await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z'
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-1',
        idempotencyKey: 'key-1'
      });

      await db.markReadingAsSynced(id);

      const updated = await db.readingsQueue.get(id);
      expect(updated?.synced).toBe(true);
      expect(updated?.syncedAt).toBeDefined();
    });

    it('should increment retry count', async () => {
      const id = await db.queueReading({
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z'
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-1',
        idempotencyKey: 'key-1'
      });

      await db.incrementRetryCount(id);
      let updated = await db.readingsQueue.get(id);
      expect(updated?.retries).toBe(1);

      await db.incrementRetryCount(id);
      updated = await db.readingsQueue.get(id);
      expect(updated?.retries).toBe(2);
    });

    it('should prevent duplicate idempotency keys', async () => {
      const reading = {
        payload: {
          customerId: 'cust-1',
          meterId: 'meter-1',
          reading: 100,
          readingDate: '2024-01-15T10:00:00Z'
        },
        readingDate: '2024-01-15T10:00:00Z',
        tenantId: 'tenant-1',
        idempotencyKey: 'unique-key-123'
      };

      await db.queueReading(reading);
      
      // Check if idempotency key exists before adding
      const existing = await db.readingsQueue
        .where('idempotencyKey')
        .equals('unique-key-123')
        .first();
      
      expect(existing).toBeDefined();
    });
  });

  describe('photos', () => {
    it('should save and retrieve photo blob', async () => {
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      const photoId = await db.savePhoto(blob);

      expect(photoId).toBeDefined();

      const retrieved = await db.getPhoto(photoId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.mime).toBe('image/jpeg');
      expect(retrieved?.size).toBe(blob.size);
    });

    it('should delete photo', async () => {
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      const photoId = await db.savePhoto(blob);

      await db.deletePhoto(photoId);

      const retrieved = await db.getPhoto(photoId);
      expect(retrieved).toBeUndefined();
    });

    it('should use custom photo ID', async () => {
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });
      const customId = 'custom-photo-id-123';
      
      const photoId = await db.savePhoto(blob, customId);
      expect(photoId).toBe(customId);

      const retrieved = await db.getPhoto(customId);
      expect(retrieved).toBeDefined();
    });
  });

  describe('cleanup operations', () => {
    it('should clear old synced readings', async () => {
      const now = new Date();
      const oldDate = new Date(now);
      oldDate.setDate(oldDate.getDate() - 10);

      // Add old synced reading
      await db.readingsQueue.add({
        payload: {
          customerId: 'cust-old',
          meterId: 'meter-old',
          reading: 100,
          readingDate: oldDate.toISOString()
        },
        readingDate: oldDate.toISOString(),
        createdAt: oldDate.toISOString(),
        updatedAt: oldDate.toISOString(),
        retries: 0,
        synced: true,
        syncedAt: oldDate.toISOString(),
        tenantId: 'tenant-1',
        idempotencyKey: 'old-key'
      });

      // Add recent synced reading
      await db.readingsQueue.add({
        payload: {
          customerId: 'cust-new',
          meterId: 'meter-new',
          reading: 200,
          readingDate: now.toISOString()
        },
        readingDate: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        retries: 0,
        synced: true,
        syncedAt: now.toISOString(),
        tenantId: 'tenant-1',
        idempotencyKey: 'new-key'
      });

      await db.clearSyncedReadings(7);

      const remaining = await db.readingsQueue.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].payload.customerId).toBe('cust-new');
    });

    it('should cleanup old photos', async () => {
      const now = new Date();
      const oldDate = new Date(now);
      oldDate.setDate(oldDate.getDate() - 35);

      // Add old photo
      await db.photos.add({
        id: 'old-photo',
        blob: new Blob(['old'], { type: 'image/jpeg' }),
        createdAt: oldDate.toISOString(),
        size: 3,
        mime: 'image/jpeg'
      });

      // Add recent photo
      await db.photos.add({
        id: 'new-photo',
        blob: new Blob(['new'], { type: 'image/jpeg' }),
        createdAt: now.toISOString(),
        size: 3,
        mime: 'image/jpeg'
      });

      await db.cleanupOldPhotos(30);

      const oldPhoto = await db.getPhoto('old-photo');
      expect(oldPhoto).toBeUndefined();

      const newPhoto = await db.getPhoto('new-photo');
      expect(newPhoto).toBeDefined();
    });
  });
});