import { db } from '@/lib/db/offline';

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  tenantId: string | null;
  userId: string | null;
  expiresAt: number | null;
}

const AUTH_STATE_KEY = 'flowtrack_auth_state';
const AUTH_SYNC_CHANNEL = 'flowtrack_auth_sync';

// BroadcastChannel for cross-tab auth sync
let authChannel: BroadcastChannel | null = null;

if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  authChannel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
}

/**
 * Store auth state in IndexedDB for service worker access
 */
export async function storeAuthState(state: AuthState): Promise<void> {
  if (typeof window === 'undefined') return;

  // Store in IndexedDB for service worker access
  const transaction = db.transaction('rw', db.readingsQueue, async () => {
    // Using a special ID for auth state
    const authRecord = {
      id: -1, // Special ID for auth state
      payload: state as any,
      readingDate: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      retries: 0,
      synced: true,
      tenantId: state.tenantId || '',
      idempotencyKey: 'AUTH_STATE'
    };

    await db.readingsQueue.put(authRecord);
  });

  await transaction;

  // Notify service worker and other tabs
  if (authChannel) {
    authChannel.postMessage({
      type: 'AUTH_STATE_UPDATE',
      state
    });
  }

  // Notify service worker directly
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'AUTH_STATE_UPDATE',
      state
    });
  }
}

/**
 * Retrieve auth state from IndexedDB
 */
export async function getAuthState(): Promise<AuthState | null> {
  if (typeof window === 'undefined') return null;

  try {
    const authRecord = await db.readingsQueue.get(-1);
    if (authRecord && authRecord.idempotencyKey === 'AUTH_STATE') {
      return authRecord.payload as unknown as AuthState;
    }
  } catch (error) {
    console.error('Failed to get auth state:', error);
  }

  return null;
}

/**
 * Clear auth state from IndexedDB
 */
export async function clearAuthState(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    await db.readingsQueue.delete(-1);

    // Notify service worker and other tabs
    if (authChannel) {
      authChannel.postMessage({
        type: 'AUTH_STATE_CLEAR'
      });
    }

    // Notify service worker directly
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'AUTH_STATE_CLEAR'
      });
    }
  } catch (error) {
    console.error('Failed to clear auth state:', error);
  }
}

/**
 * Listen for auth state changes from other tabs
 */
export function listenForAuthChanges(callback: (state: AuthState | null) => void): () => void {
  if (!authChannel) return () => {};

  const handler = (event: MessageEvent) => {
    if (event.data.type === 'AUTH_STATE_UPDATE') {
      callback(event.data.state);
    } else if (event.data.type === 'AUTH_STATE_CLEAR') {
      callback(null);
    }
  };

  authChannel.addEventListener('message', handler);

  return () => {
    authChannel?.removeEventListener('message', handler);
  };
}

/**
 * Check if auth token is expired
 */
export function isTokenExpired(expiresAt: number | null): boolean {
  if (!expiresAt) return true;
  return Date.now() >= expiresAt * 1000; // expiresAt is in seconds
}

/**
 * Request token refresh from main app
 */
export async function requestTokenRefresh(): Promise<AuthState | null> {
  if (typeof window === 'undefined') return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    
    channel.port1.onmessage = (event) => {
      if (event.data.type === 'TOKEN_REFRESH_RESPONSE') {
        resolve(event.data.state);
      } else {
        resolve(null);
      }
    };

    // Request refresh from main app
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(
        { type: 'TOKEN_REFRESH_REQUEST' },
        [channel.port2]
      );
    } else {
      resolve(null);
    }

    // Timeout after 5 seconds
    setTimeout(() => resolve(null), 5000);
  });
}

/**
 * Extract tenant ID from hostname
 */
export function getTenantFromHostname(hostname: string): string | null {
  // Handle localhost development
  if (hostname === 'localhost' || hostname.startsWith('127.0.0.1')) {
    return 'demo'; // Default tenant for development
  }

  // Extract subdomain
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    const subdomain = parts[0];
    // Ignore www
    if (subdomain === 'www') {
      return parts.length >= 3 ? parts[1] : null;
    }
    return subdomain;
  }

  return null;
}

/**
 * Add auth headers to a fetch request
 */
export async function addAuthHeaders(
  headers: Headers,
  authState?: AuthState | null
): Promise<Headers> {
  const state = authState || await getAuthState();
  
  if (state?.accessToken) {
    // Check if token is expired
    if (isTokenExpired(state.expiresAt)) {
      // Try to refresh
      const refreshedState = await requestTokenRefresh();
      if (refreshedState?.accessToken) {
        headers.set('Authorization', `Bearer ${refreshedState.accessToken}`);
        if (refreshedState.tenantId) {
          headers.set('X-Tenant-Id', refreshedState.tenantId);
        }
      }
    } else {
      headers.set('Authorization', `Bearer ${state.accessToken}`);
      if (state.tenantId) {
        headers.set('X-Tenant-Id', state.tenantId);
      }
    }
  }

  return headers;
}