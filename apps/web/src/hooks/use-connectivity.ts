'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';

export interface ConnectivityState {
  isOnline: boolean;
  isSlowConnection: boolean;
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

export function useConnectivity() {
  const [state, setState] = useState<ConnectivityState>(() => ({
    isOnline: typeof window !== 'undefined' ? navigator.onLine : true,
    isSlowConnection: false,
  }));

  const updateConnectionInfo = useCallback(() => {
    if (typeof window === 'undefined') return;

    const connection = (navigator as any).connection || 
                      (navigator as any).mozConnection || 
                      (navigator as any).webkitConnection;

    if (connection) {
      const effectiveType = connection.effectiveType;
      const isSlowConnection = effectiveType === 'slow-2g' || 
                              effectiveType === '2g' || 
                              connection.rtt > 750 ||
                              connection.downlink < 0.5;

      setState(prev => ({
        ...prev,
        isSlowConnection,
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt,
        saveData: connection.saveData,
      }));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let offlineToastId: string | number | undefined;
    let slowConnectionToastId: string | number | undefined;

    const handleOnline = () => {
      setState(prev => ({ ...prev, isOnline: true }));
      
      // Dismiss offline toast
      if (offlineToastId) {
        toast.dismiss(offlineToastId);
      }
      
      // Show online notification
      toast.success('Back online', {
        description: 'Your connection has been restored. Syncing data...',
        duration: 3000,
        id: 'online-status',
      });

      // Announce to screen readers
      const announcement = document.createElement('div');
      announcement.setAttribute('role', 'status');
      announcement.setAttribute('aria-live', 'polite');
      announcement.className = 'sr-only';
      announcement.textContent = 'Connection restored. Back online.';
      document.body.appendChild(announcement);
      setTimeout(() => document.body.removeChild(announcement), 1000);
    };

    const handleOffline = () => {
      setState(prev => ({ ...prev, isOnline: false }));
      
      // Show persistent offline toast
      offlineToastId = toast.error('You are offline', {
        description: 'Some features may be limited. Your data will sync when connection is restored.',
        duration: Infinity,
        id: 'offline-status',
      });

      // Announce to screen readers
      const announcement = document.createElement('div');
      announcement.setAttribute('role', 'alert');
      announcement.setAttribute('aria-live', 'assertive');
      announcement.className = 'sr-only';
      announcement.textContent = 'Connection lost. You are now offline.';
      document.body.appendChild(announcement);
      setTimeout(() => document.body.removeChild(announcement), 1000);
    };

    const handleConnectionChange = () => {
      updateConnectionInfo();
      
      const connection = (navigator as any).connection;
      if (connection) {
        const effectiveType = connection.effectiveType;
        const isSlowConnection = effectiveType === 'slow-2g' || 
                                effectiveType === '2g' || 
                                connection.rtt > 750;

        if (isSlowConnection && !state.isSlowConnection) {
          // Show slow connection warning
          if (slowConnectionToastId) {
            toast.dismiss(slowConnectionToastId);
          }
          
          slowConnectionToastId = toast.warning('Slow connection detected', {
            description: 'Some features may take longer to load.',
            duration: 5000,
            id: 'slow-connection',
          });
        } else if (!isSlowConnection && state.isSlowConnection) {
          // Connection improved
          if (slowConnectionToastId) {
            toast.dismiss(slowConnectionToastId);
          }
        }
      }
    };

    // Set initial state
    updateConnectionInfo();
    if (!navigator.onLine) {
      handleOffline();
    }

    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Connection quality monitoring
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', handleConnectionChange);
    }

    // Cleanup
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      
      if (connection) {
        connection.removeEventListener('change', handleConnectionChange);
      }

      // Dismiss any active toasts
      if (offlineToastId) toast.dismiss(offlineToastId);
      if (slowConnectionToastId) toast.dismiss(slowConnectionToastId);
    };
  }, [updateConnectionInfo, state.isSlowConnection]);

  return state;
}