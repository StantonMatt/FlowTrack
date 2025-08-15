'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';

export interface ServiceWorkerState {
  isSupported: boolean;
  registration: ServiceWorkerRegistration | null;
  isUpdateAvailable: boolean;
  isInstalling: boolean;
}

export function useServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    registration: null,
    isUpdateAvailable: false,
    isInstalling: false,
  });

  const skipWaiting = useCallback(() => {
    if (state.registration?.waiting) {
      // Tell the waiting service worker to activate
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }, [state.registration]);

  const checkForUpdate = useCallback(async () => {
    if (state.registration) {
      try {
        await state.registration.update();
      } catch (error) {
        console.error('Failed to check for updates:', error);
      }
    }
  }, [state.registration]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    setState(prev => ({ ...prev, isSupported: true }));

    let refreshing = false;
    let updateToastId: string | number | undefined;

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        setState(prev => ({ ...prev, registration }));

        // Check for updates every hour
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          setState(prev => ({ ...prev, isInstalling: true }));

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') {
              setState(prev => ({ ...prev, isInstalling: false }));

              if (navigator.serviceWorker.controller) {
                // New update available
                setState(prev => ({ ...prev, isUpdateAvailable: true }));

                // Show update toast
                updateToastId = toast('Update available', {
                  description: 'A new version of FlowTrack is available.',
                  action: {
                    label: 'Update',
                    onClick: () => {
                      skipWaiting();
                      if (!refreshing) {
                        refreshing = true;
                        window.location.reload();
                      }
                    },
                  },
                  duration: Infinity,
                  id: 'sw-update',
                });
              } else {
                // First install
                console.log('Service Worker installed for the first time');
                toast.success('FlowTrack is ready for offline use', {
                  description: 'You can now use the app even without an internet connection.',
                  duration: 5000,
                });
              }
            }
          });
        });

        // Handle controller change (when skipWaiting is called)
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });

        // Listen for messages from service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SW_ACTIVATED') {
            console.log('Service Worker activated');
          }
        });

        console.log('Service Worker registered successfully');
      } catch (error) {
        console.error('Service Worker registration failed:', error);
      }
    };

    // Register service worker
    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }

    // Cleanup
    return () => {
      if (updateToastId) {
        toast.dismiss(updateToastId);
      }
    };
  }, [skipWaiting]);

  return {
    ...state,
    skipWaiting,
    checkForUpdate,
  };
}