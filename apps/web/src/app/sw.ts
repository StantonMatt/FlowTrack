/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';
import { openDB } from 'idb';
import { initializeSyncQueue } from '@/lib/pwa/sync-queue';
import type { AuthState } from '@/lib/pwa/auth-sync';

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the
// actual precache manifest by @serwist/next.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Store auth state in memory for quick access
let cachedAuthState: AuthState | null = null;

// Disable Serwist logs in production
if (process.env.NODE_ENV === 'production') {
  self.__WB_DISABLE_DEV_LOGS = true;
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

// Helper function to get auth state from IndexedDB
async function getAuthStateFromDB(): Promise<AuthState | null> {
  try {
    const db = await openDB('FlowTrackOffline', 3);
    const tx = db.transaction('readingsQueue', 'readonly');
    const store = tx.objectStore('readingsQueue');
    const authRecord = await store.get(-1);
    
    if (authRecord && authRecord.idempotencyKey === 'AUTH_STATE') {
      return authRecord.payload as AuthState;
    }
  } catch (error) {
    console.error('Failed to get auth state from DB:', error);
  }
  return null;
}

// Helper function to add auth headers
async function addAuthHeaders(headers: Headers): Promise<Headers> {
  const authState = cachedAuthState || await getAuthStateFromDB();
  
  if (authState?.accessToken) {
    // Check if token is expired
    const expiresAt = authState.expiresAt || 0;
    if (Date.now() < expiresAt * 1000) {
      headers.set('Authorization', `Bearer ${authState.accessToken}`);
      if (authState.tenantId) {
        headers.set('X-Tenant-Id', authState.tenantId);
      }
    }
  }
  
  return headers;
}

// Listen for auth state updates from main app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'AUTH_STATE_UPDATE') {
    cachedAuthState = event.data.state;
    // Respond to confirm receipt
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: 'AUTH_STATE_RECEIVED' });
    }
  } else if (event.data?.type === 'AUTH_STATE_CLEAR') {
    cachedAuthState = null;
  } else if (event.data?.type === 'TOKEN_REFRESH_REQUEST') {
    // Forward refresh request to all clients
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'TOKEN_REFRESH_REQUEST_FROM_SW'
        });
      });
    });
  } else if (event.data?.type === 'SKIP_WAITING') {
    // Skip waiting and activate immediately
    self.skipWaiting();
  }
});

// Intercept fetch requests to add auth headers
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  
  // Only add auth headers to API requests
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
    event.respondWith(
      (async () => {
        try {
          // Clone the request to modify headers
          const modifiedHeaders = new Headers(event.request.headers);
          await addAuthHeaders(modifiedHeaders);
          
          const modifiedRequest = new Request(event.request, {
            headers: modifiedHeaders
          });
          
          const response = await fetch(modifiedRequest);
          
          // If we get a 401, try to refresh token
          if (response.status === 401) {
            // Notify clients to refresh token
            const clients = await self.clients.matchAll();
            clients.forEach(client => {
              client.postMessage({
                type: 'TOKEN_EXPIRED',
                url: event.request.url
              });
            });
          }
          
          return response;
        } catch (error) {
          console.error('Fetch failed:', error);
          throw error;
        }
      })()
    );
  }
});

// Add custom event listeners for sync
self.addEventListener('sync', (event: any) => {
  if (event.tag === 'sync-readings') {
    event.waitUntil(syncReadings());
  }
});

// Background sync function
async function syncReadings() {
  try {
    const db = await openDB('FlowTrackOffline', 3);
    
    // Get auth state
    const authState = cachedAuthState || await getAuthStateFromDB();
    if (!authState?.tenantId) {
      console.warn('No auth state available for sync');
      return;
    }
    
    // Get pending readings for this tenant
    const readingsTx = db.transaction('readingsQueue', 'readonly');
    const readingsStore = readingsTx.objectStore('readingsQueue');
    const index = readingsStore.index('[tenantId+synced]');
    const pendingReadings = await index.getAll([authState.tenantId, 0]);
    
    console.log(`Found ${pendingReadings.length} pending readings to sync`);
    
    // Sync each reading
    for (const reading of pendingReadings) {
      if (reading.id === -1) continue; // Skip auth state record
      
      try {
        const headers = new Headers({
          'Content-Type': 'application/json',
          'X-Idempotency-Key': reading.idempotencyKey,
        });
        await addAuthHeaders(headers);
        
        // Handle photo upload if exists
        let photoUrl = null;
        if (reading.photoBlobRef) {
          const photosTx = db.transaction('photos', 'readonly');
          const photosStore = photosTx.objectStore('photos');
          const photo = await photosStore.get(reading.photoBlobRef);
          
          if (photo) {
            // Import photo upload service dynamically
            const { photoUploadService } = await import('@/lib/sync/photo-upload');
            const uploadResult = await photoUploadService.uploadPhoto(photo.blob, {
              tenantId: authState.tenantId,
              customerId: reading.payload.customerId,
              readingId: reading.payload.id,
              idempotencyKey: reading.idempotencyKey,
            });
            
            if (uploadResult.success) {
              photoUrl = uploadResult.url;
              console.log('Photo uploaded during background sync:', uploadResult.path);
            }
          }
        }
        
        // Add photo URL to payload if uploaded
        const payload = {
          ...reading.payload,
          ...(photoUrl && { photoUrl }),
        };
        
        const response = await fetch('/api/readings', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        
        if (response.ok) {
          // Mark as synced
          const writeTx = db.transaction('readingsQueue', 'readwrite');
          const writeStore = writeTx.objectStore('readingsQueue');
          await writeStore.put({
            ...reading,
            synced: true,
            syncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          await writeTx.complete;
          
          // Clean up photo if successfully synced
          if (reading.photoBlobRef) {
            const photoDeleteTx = db.transaction('photos', 'readwrite');
            const photoDeleteStore = photoDeleteTx.objectStore('photos');
            await photoDeleteStore.delete(reading.photoBlobRef);
            await photoDeleteTx.complete;
          }
        } else if (response.status === 401) {
          // Auth expired, stop syncing
          console.warn('Auth expired during sync');
          break;
        } else {
          // Increment retry count
          const writeTx = db.transaction('readingsQueue', 'readwrite');
          const writeStore = writeTx.objectStore('readingsQueue');
          await writeStore.put({
            ...reading,
            retries: (reading.retries || 0) + 1,
            updatedAt: new Date().toISOString()
          });
          await writeTx.complete;
        }
      } catch (error) {
        console.error(`Failed to sync reading ${reading.id}:`, error);
      }
    }
    
    console.log('Background sync completed');
  } catch (error) {
    console.error('Sync failed:', error);
  }
}

// Load initial auth state on service worker activation
self.addEventListener('activate', async (event) => {
  event.waitUntil(
    (async () => {
      cachedAuthState = await getAuthStateFromDB();
      console.log('Service worker activated, auth state loaded');
      
      // Initialize the background sync queue
      initializeSyncQueue();
      console.log('Background sync queue initialized');
    })()
  );
});

// Handle manual sync trigger from main app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'TRIGGER_SYNC') {
    syncReadings().then(() => {
      console.log('Manual sync completed');
    }).catch(error => {
      console.error('Manual sync failed:', error);
    });
  }
});

serwist.addEventListeners();