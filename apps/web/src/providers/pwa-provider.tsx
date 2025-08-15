'use client';

import { useEffect } from 'react';
import { useServiceWorker } from '@/hooks/use-service-worker';
import { useConnectivity } from '@/hooks/use-connectivity';
import { useAuthSync } from '@/hooks/use-auth-sync';
import { useSyncManager } from '@/hooks/use-sync-manager';
import { PWAInstallPrompt } from '@/components/pwa-install-prompt';
import { toast } from 'sonner';

interface PWAProviderProps {
  children: React.ReactNode;
}

export function PWAProvider({ children }: PWAProviderProps) {
  // Initialize all PWA hooks
  const serviceWorker = useServiceWorker();
  const connectivity = useConnectivity();
  const authSync = useAuthSync();
  const syncManager = useSyncManager({
    autoSync: true,
    syncInterval: 60000, // Sync every minute when online
  });

  // Handle service worker updates
  useEffect(() => {
    if (serviceWorker.isUpdateAvailable) {
      console.log('Service worker update available');
    }
  }, [serviceWorker.isUpdateAvailable]);

  // Handle connectivity changes
  useEffect(() => {
    if (connectivity.isOnline && !syncManager.isSyncing) {
      // Trigger sync when coming back online
      console.log('Back online, triggering sync');
      syncManager.scheduleSync(2000); // Wait 2 seconds then sync
    }
  }, [connectivity.isOnline, syncManager]);

  // Log sync errors
  useEffect(() => {
    if (syncManager.lastError) {
      console.error('Sync error:', syncManager.lastError);
      
      // Only show error toast for non-network errors when online
      if (connectivity.isOnline) {
        toast.error('Sync failed', {
          description: 'Some readings could not be synced. They will be retried automatically.',
        });
      }
    }
  }, [syncManager.lastError, connectivity.isOnline]);

  // Handle page visibility for sync
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && connectivity.isOnline) {
        // Page became visible and we're online
        syncManager.refreshProgress();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connectivity.isOnline, syncManager]);

  // Periodic cleanup of old data
  useEffect(() => {
    const cleanup = async () => {
      try {
        const { syncManager: sm } = await import('@/lib/sync/sync-manager');
        await sm.cleanup(7); // Clean up data older than 7 days
        console.log('Cleanup completed');
      } catch (error) {
        console.error('Cleanup failed:', error);
      }
    };

    // Run cleanup on load
    cleanup();

    // Schedule daily cleanup
    const interval = setInterval(cleanup, 24 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {children}
      <PWAInstallPrompt />
    </>
  );
}