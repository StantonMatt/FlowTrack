'use client';

/**
 * Client-side React hooks for realtime subscriptions
 */
import { useEffect, useRef } from 'react';
import { RealtimeSubscriber, type RealtimeMessage } from './events';

export function useRealtimeSubscription<T = any>(
  channelName: string | null,
  handler: (message: RealtimeMessage<T>) => void,
  deps: any[] = []
) {
  const subscriberRef = useRef<RealtimeSubscriber>();
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!channelName) return;

    // Create subscriber if not exists
    if (!subscriberRef.current) {
      subscriberRef.current = new RealtimeSubscriber();
    }

    // Unsubscribe from previous subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    // Subscribe to new channel
    unsubscribeRef.current = subscriberRef.current.subscribe(channelName, handler);

    // Cleanup on unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [channelName, ...deps]);

  // Clean up subscriber on unmount
  useEffect(() => {
    return () => {
      if (subscriberRef.current) {
        subscriberRef.current.unsubscribeAll();
      }
    };
  }, []);
}

/**
 * React hook for tenant reading subscriptions
 */
export function useTenantReadings(
  tenantId: string | null,
  handler: (message: RealtimeMessage<any>) => void
) {
  useRealtimeSubscription(
    tenantId ? `tenant:${tenantId}:readings` : null,
    handler,
    [tenantId]
  );
}

/**
 * React hook for reading subscriptions (alias for useTenantReadings)
 */
export function useReadingsSubscription(
  tenantId: string | null,
  handler: (message: RealtimeMessage<any>) => void
) {
  useTenantReadings(tenantId, handler);
}

/**
 * React hook for customer billing subscriptions
 */
export function useCustomerBilling(
  customerId: string | null,
  handler: (message: RealtimeMessage<any>) => void
) {
  useRealtimeSubscription(
    customerId ? `customer:${customerId}:billing` : null,
    handler,
    [customerId]
  );
}