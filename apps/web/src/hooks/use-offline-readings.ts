import { useState, useEffect, useCallback, useRef } from 'react';
import { offlineReadingQueue } from '@/lib/readings/offline-queue';
import { useAuth } from '@/hooks/use-auth';
import { useConnectivity } from '@/hooks/use-connectivity';
import type { CreateReading } from '@shared/schemas/reading';
import type { QueuedReading, QueueStatistics } from '@/lib/readings/offline-queue';

interface UseOfflineReadingsReturn {
  queuedReadings: QueuedReading[];
  statistics: QueueStatistics | null;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  queueReading: (reading: CreateReading, options?: QueueOptions) => Promise<string>;
  updateReading: (clientId: string, updates: Partial<CreateReading>) => Promise<void>;
  deleteReading: (clientId: string) => Promise<void>;
  syncNow: () => Promise<void>;
  clearQueue: (includeSynced?: boolean) => Promise<void>;
  refreshQueue: () => Promise<void>;
}

interface QueueOptions {
  photoId?: string;
  priority?: 'normal' | 'high';
}

export function useOfflineReadings(): UseOfflineReadingsReturn {
  const { session } = useAuth();
  const { isOnline } = useConnectivity();
  const [queuedReadings, setQueuedReadings] = useState<QueuedReading[]>([]);
  const [statistics, setStatistics] = useState<QueueStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const tenantId = session?.user?.user_metadata?.tenant_id;
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load queued readings
  const loadQueue = useCallback(async () => {
    if (!tenantId) return;

    setIsLoading(true);
    setError(null);

    try {
      const [readings, stats] = await Promise.all([
        offlineReadingQueue.getQueuedReadings(tenantId),
        offlineReadingQueue.getQueueStatistics(tenantId),
      ]);

      setQueuedReadings(readings);
      setStatistics(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
      console.error('Error loading offline queue:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  // Queue a new reading
  const queueReading = useCallback(async (
    reading: CreateReading,
    options: QueueOptions = {}
  ): Promise<string> => {
    if (!tenantId) {
      throw new Error('No tenant ID available');
    }

    try {
      const clientId = await offlineReadingQueue.queueReading(
        tenantId,
        reading,
        options
      );

      // Reload queue
      await loadQueue();

      // Schedule sync if online and high priority
      if (isOnline && options.priority === 'high') {
        scheduleSyncWithDelay(1000); // Sync after 1 second
      }

      return clientId;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to queue reading';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [tenantId, isOnline, loadQueue]);

  // Update a queued reading
  const updateReading = useCallback(async (
    clientId: string,
    updates: Partial<CreateReading>
  ): Promise<void> => {
    try {
      await offlineReadingQueue.updateQueuedReading(clientId, updates);
      await loadQueue();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update reading';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [loadQueue]);

  // Delete a queued reading
  const deleteReading = useCallback(async (clientId: string): Promise<void> => {
    try {
      await offlineReadingQueue.deleteQueuedReading(clientId);
      await loadQueue();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete reading';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [loadQueue]);

  // Sync readings with server
  const syncNow = useCallback(async (): Promise<void> => {
    if (!tenantId || isSyncing || !isOnline) {
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      const result = await offlineReadingQueue.syncReadings(tenantId, {
        batchSize: 10,
        maxRetries: 3,
      });

      if (result.failed > 0) {
        setError(`${result.failed} readings failed to sync`);
      }

      // Reload queue after sync
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      console.error('Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [tenantId, isSyncing, isOnline, loadQueue]);

  // Clear the queue
  const clearQueue = useCallback(async (includeSynced = false): Promise<void> => {
    if (!tenantId) {
      throw new Error('No tenant ID available');
    }

    try {
      await offlineReadingQueue.clearQueue(tenantId, { includeSynced });
      await loadQueue();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to clear queue';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [tenantId, loadQueue]);

  // Schedule sync with delay
  const scheduleSyncWithDelay = useCallback((delay: number) => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      syncNow();
    }, delay);
  }, [syncNow]);

  // Setup auto-sync when online
  useEffect(() => {
    if (!isOnline || !tenantId) {
      return;
    }

    // Initial sync when coming online
    const checkAndSync = async () => {
      const stats = await offlineReadingQueue.getQueueStatistics(tenantId);
      if (stats.pending > 0) {
        syncNow();
      }
    };

    checkAndSync();

    // Setup periodic sync every 5 minutes
    autoSyncIntervalRef.current = setInterval(() => {
      checkAndSync();
    }, 5 * 60 * 1000);

    return () => {
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
      }
    };
  }, [isOnline, tenantId, syncNow]);

  // Load queue on mount and when tenant changes
  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
      }
      // Revoke any object URLs
      queuedReadings.forEach(reading => {
        if (reading.photoUrl) {
          URL.revokeObjectURL(reading.photoUrl);
        }
      });
    };
  }, [queuedReadings]);

  return {
    queuedReadings,
    statistics,
    isLoading,
    isSyncing,
    error,
    queueReading,
    updateReading,
    deleteReading,
    syncNow,
    clearQueue,
    refreshQueue: loadQueue,
  };
}

// Hook for individual queued reading
export function useQueuedReading(clientId: string) {
  const [reading, setReading] = useState<QueuedReading | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadReading = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await offlineReadingQueue.getQueuedReading(clientId);
        setReading(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load reading');
      } finally {
        setIsLoading(false);
      }
    };

    loadReading();

    // Cleanup photo URL on unmount
    return () => {
      if (reading?.photoUrl) {
        URL.revokeObjectURL(reading.photoUrl);
      }
    };
  }, [clientId]);

  return { reading, isLoading, error };
}

// Hook for sync status
export function useOfflineSyncStatus() {
  const { session } = useAuth();
  const { isOnline } = useConnectivity();
  const [status, setStatus] = useState<{
    lastSync: Date | null;
    pending: number;
    failed: number;
    nextSyncIn: number | null;
  }>({
    lastSync: null,
    pending: 0,
    failed: 0,
    nextSyncIn: null,
  });

  const tenantId = session?.user?.user_metadata?.tenant_id;

  useEffect(() => {
    if (!tenantId) return;

    const updateStatus = async () => {
      const stats = await offlineReadingQueue.getQueueStatistics(tenantId);
      
      setStatus({
        lastSync: stats.lastSyncAttempt,
        pending: stats.pending,
        failed: stats.failed,
        nextSyncIn: isOnline && stats.pending > 0 ? 60 : null, // Next sync in 60 seconds if online and have pending
      });
    };

    updateStatus();

    // Update every 10 seconds
    const interval = setInterval(updateStatus, 10000);

    return () => clearInterval(interval);
  }, [tenantId, isOnline]);

  return status;
}