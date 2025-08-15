'use client';

import { useEffect, useCallback } from 'react';
import { useSupabase } from '@/hooks/use-supabase';
import { 
  storeAuthState, 
  clearAuthState, 
  listenForAuthChanges,
  type AuthState 
} from '@/lib/pwa/auth-sync';

/**
 * Hook to sync Supabase auth state with service worker
 */
export function useAuthSync() {
  const { supabase } = useSupabase();

  // Update auth state in IndexedDB and notify service worker
  const updateAuthState = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        // Extract tenant ID from user metadata or JWT claims
        const tenantId = session.user.user_metadata?.tenant_id || 
                        session.user.app_metadata?.tenant_id ||
                        null;
        
        const authState: AuthState = {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          tenantId,
          userId: session.user.id,
          expiresAt: session.expires_at || null
        };
        
        await storeAuthState(authState);
      } else {
        await clearAuthState();
      }
    } catch (error) {
      console.error('Failed to update auth state:', error);
    }
  }, [supabase]);

  // Handle token refresh requests from service worker
  const handleTokenRefreshRequest = useCallback(async () => {
    try {
      const { data: { session }, error } = await supabase.auth.refreshSession();
      
      if (error) {
        console.error('Token refresh failed:', error);
        await clearAuthState();
        return;
      }
      
      if (session) {
        const tenantId = session.user.user_metadata?.tenant_id || 
                        session.user.app_metadata?.tenant_id ||
                        null;
        
        const authState: AuthState = {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          tenantId,
          userId: session.user.id,
          expiresAt: session.expires_at || null
        };
        
        await storeAuthState(authState);
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
  }, [supabase]);

  useEffect(() => {
    // Initial auth state sync
    updateAuthState();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event);
        
        if (session) {
          const tenantId = session.user.user_metadata?.tenant_id || 
                          session.user.app_metadata?.tenant_id ||
                          null;
          
          const authState: AuthState = {
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            tenantId,
            userId: session.user.id,
            expiresAt: session.expires_at || null
          };
          
          await storeAuthState(authState);
        } else {
          await clearAuthState();
        }
        
        // Handle specific events
        if (event === 'TOKEN_REFRESHED') {
          console.log('Token refreshed successfully');
        } else if (event === 'SIGNED_OUT') {
          console.log('User signed out');
        }
      }
    );

    // Listen for token refresh requests from service worker
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TOKEN_REFRESH_REQUEST_FROM_SW') {
        handleTokenRefreshRequest();
      } else if (event.data?.type === 'TOKEN_EXPIRED') {
        console.log('Token expired for URL:', event.data.url);
        handleTokenRefreshRequest();
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
    }

    // Listen for auth changes from other tabs
    const unsubscribeFromAuthChanges = listenForAuthChanges((state) => {
      console.log('Auth state changed in another tab:', state);
      // Could trigger UI updates here if needed
    });

    // Cleanup
    return () => {
      subscription.unsubscribe();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
      unsubscribeFromAuthChanges();
    };
  }, [supabase, updateAuthState, handleTokenRefreshRequest]);

  return {
    updateAuthState,
    handleTokenRefreshRequest
  };
}