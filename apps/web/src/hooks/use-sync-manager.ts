'use client';

import { useEffect, useState, useCallback } from 'react';
import { syncManager, type SyncProgress } from '@/lib/sync/sync-manager';
import { useAuthSync } from './use-auth-sync';

export interface UseSyncManagerOptions {
  autoSync?: boolean;
  syncInterval?: number; // milliseconds
}

export function useSyncManager(options: UseSyncManagerOptions = {}) {
  const { autoSync = true, syncInterval = 60000 } = options; // Default 1 minute
  const [progress, setProgress] = useState<SyncProgress>({
    total: 0,
    synced: 0,
    failed: 0,
    inProgress: false,
  });
  const [lastError, setLastError] = useState<Error | null>(null);
  
  // Ensure auth is synced
  useAuthSync();

  // Manual sync trigger
  const triggerSync = useCallback(async () => {
    try {
      setLastError(null);
      await syncManager.sync();
    } catch (error) {
      setLastError(error as Error);
      console.error('Manual sync failed:', error);
    }
  }, []);

  // Cancel ongoing sync
  const cancelSync = useCallback(() => {
    syncManager.cancel();
  }, []);

  // Get current progress
  const refreshProgress = useCallback(async () => {
    const currentProgress = await syncManager.getProgress();
    setProgress(currentProgress);
  }, []);

  // Schedule sync
  const scheduleSync = useCallback((delayMs?: number) => {
    syncManager.schedule(delayMs);
  }, []);

  useEffect(() => {
    // Listen to sync events
    const handleProgress = (p: SyncProgress) => {
      setProgress(p);
    };

    const handleComplete = (p: SyncProgress) => {
      setProgress(p);
      console.log('Sync completed:', p);
    };

    const handleError = (error: Error) => {
      setLastError(error);
      console.error('Sync error:', error);
    };

    syncManager.on('progress', handleProgress);
    syncManager.on('complete', handleComplete);
    syncManager.on('error', handleError);

    // Initial progress load
    refreshProgress();

    // Auto sync setup
    let syncIntervalId: NodeJS.Timeout | null = null;
    if (autoSync && syncInterval > 0) {
      // Initial sync after mount
      const initialTimeout = setTimeout(() => {
        triggerSync();
      }, 5000); // Wait 5 seconds after mount

      // Regular sync interval
      syncIntervalId = setInterval(() => {
        if (!syncManager.isCurrentlySyncing()) {
          triggerSync();
        }
      }, syncInterval);

      // Sync on online event
      const handleOnline = () => {
        console.log('Network online, triggering sync');
        scheduleSync(2000); // Wait 2 seconds then sync
      };
      window.addEventListener('online', handleOnline);

      // Sync on visibility change
      const handleVisibilityChange = () => {
        if (!document.hidden && !syncManager.isCurrentlySyncing()) {
          scheduleSync(1000); // Wait 1 second then sync
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearTimeout(initialTimeout);
        if (syncIntervalId) clearInterval(syncIntervalId);
        window.removeEventListener('online', handleOnline);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        syncManager.off('progress', handleProgress);
        syncManager.off('complete', handleComplete);
        syncManager.off('error', handleError);
      };
    }

    return () => {
      syncManager.off('progress', handleProgress);
      syncManager.off('complete', handleComplete);
      syncManager.off('error', handleError);
    };
  }, [autoSync, syncInterval, triggerSync, scheduleSync, refreshProgress]);

  return {
    progress,
    lastError,
    isSyncing: progress.inProgress,
    triggerSync,
    cancelSync,
    scheduleSync,
    refreshProgress,
  };
}