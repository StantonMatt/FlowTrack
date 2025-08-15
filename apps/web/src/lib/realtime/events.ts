import { createClient } from '@/lib/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Event types for realtime messages
 */
export enum RealtimeEventType {
  READING_INSERT = 'reading.insert',
  READING_UPDATE = 'reading.update',
  READING_DELETE = 'reading.delete',
  INVOICE_CREATED = 'invoice.created',
  PAYMENT_RECEIVED = 'payment.received',
  ANOMALY_DETECTED = 'anomaly.detected',
}

/**
 * Standard message schema for realtime events
 */
export interface RealtimeMessage<T = any> {
  type: RealtimeEventType | string;
  tenantId: string;
  timestamp: string;
  payload: T;
  userId?: string;
  correlationId?: string;
}

/**
 * Reading event payload
 */
export interface ReadingEventPayload {
  readingId: string;
  customerId: string;
  readingValue: number;
  readingDate: string;
  consumption: number | null;
  anomalyFlag: boolean;
  anomalyReasons?: string[];
}

/**
 * Realtime event emitter for server-side use
 */
export class RealtimeEmitter {
  private supabase = createClient();

  /**
   * Emit a reading insert event
   */
  async emitReadingInsert(
    tenantId: string,
    payload: ReadingEventPayload,
    userId?: string
  ): Promise<void> {
    const message: RealtimeMessage<ReadingEventPayload> = {
      type: RealtimeEventType.READING_INSERT,
      tenantId,
      timestamp: new Date().toISOString(),
      payload,
      userId,
      correlationId: crypto.randomUUID(),
    };

    await this.broadcast(`tenant:${tenantId}:readings`, message);
  }

  /**
   * Emit a reading update event
   */
  async emitReadingUpdate(
    tenantId: string,
    payload: ReadingEventPayload,
    userId?: string
  ): Promise<void> {
    const message: RealtimeMessage<ReadingEventPayload> = {
      type: RealtimeEventType.READING_UPDATE,
      tenantId,
      timestamp: new Date().toISOString(),
      payload,
      userId,
      correlationId: crypto.randomUUID(),
    };

    await this.broadcast(`tenant:${tenantId}:readings`, message);
  }

  /**
   * Emit an anomaly detected event
   */
  async emitAnomalyDetected(
    tenantId: string,
    payload: {
      readingId: string;
      customerId: string;
      anomalyType: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      details: any;
    },
    userId?: string
  ): Promise<void> {
    const message: RealtimeMessage = {
      type: RealtimeEventType.ANOMALY_DETECTED,
      tenantId,
      timestamp: new Date().toISOString(),
      payload,
      userId,
      correlationId: crypto.randomUUID(),
    };

    await this.broadcast(`tenant:${tenantId}:anomalies`, message);
  }

  /**
   * Emit a custom event
   */
  async emitCustom(
    channel: string,
    type: string,
    payload: any,
    tenantId?: string,
    userId?: string
  ): Promise<void> {
    const message: RealtimeMessage = {
      type,
      tenantId: tenantId || 'system',
      timestamp: new Date().toISOString(),
      payload,
      userId,
      correlationId: crypto.randomUUID(),
    };

    await this.broadcast(channel, message);
  }

  /**
   * Broadcast message to a channel
   */
  private async broadcast(channel: string, message: RealtimeMessage): Promise<void> {
    try {
      const { error } = await this.supabase
        .channel(channel)
        .send({
          type: 'broadcast',
          event: message.type,
          payload: message,
        });

      if (error) {
        console.error('Failed to broadcast realtime event:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error broadcasting to channel', channel, error);
      throw error;
    }
  }
}

/**
 * Realtime subscription manager for client-side use
 */
export class RealtimeSubscriber {
  private supabase = createClient();
  private channels = new Map<string, RealtimeChannel>();
  private handlers = new Map<string, Set<(message: RealtimeMessage) => void>>();

  /**
   * Subscribe to reading events for a tenant
   */
  subscribeToReadings(
    tenantId: string,
    handler: (message: RealtimeMessage<ReadingEventPayload>) => void
  ): () => void {
    const channelName = `tenant:${tenantId}:readings`;
    return this.subscribe(channelName, handler);
  }

  /**
   * Subscribe to anomaly events for a tenant
   */
  subscribeToAnomalies(
    tenantId: string,
    handler: (message: RealtimeMessage) => void
  ): () => void {
    const channelName = `tenant:${tenantId}:anomalies`;
    return this.subscribe(channelName, handler);
  }

  /**
   * Subscribe to a custom channel
   */
  subscribe(
    channelName: string,
    handler: (message: RealtimeMessage) => void
  ): () => void {
    // Get or create channel
    let channel = this.channels.get(channelName);
    
    if (!channel) {
      channel = this.supabase.channel(channelName);
      
      // Set up the channel subscription
      channel
        .on('broadcast', { event: '*' }, (payload) => {
          const handlers = this.handlers.get(channelName);
          if (handlers) {
            handlers.forEach(h => h(payload.payload as RealtimeMessage));
          }
        })
        .subscribe((status) => {
          console.log(`[Realtime] Channel ${channelName} status:`, status);
        });

      this.channels.set(channelName, channel);
    }

    // Add handler
    if (!this.handlers.has(channelName)) {
      this.handlers.set(channelName, new Set());
    }
    this.handlers.get(channelName)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(channelName);
      if (handlers) {
        handlers.delete(handler);
        
        // If no more handlers, unsubscribe from channel
        if (handlers.size === 0) {
          this.unsubscribeChannel(channelName);
        }
      }
    };
  }

  /**
   * Unsubscribe from a channel
   */
  private async unsubscribeChannel(channelName: string): Promise<void> {
    const channel = this.channels.get(channelName);
    if (channel) {
      await this.supabase.removeChannel(channel);
      this.channels.delete(channelName);
      this.handlers.delete(channelName);
      console.log(`[Realtime] Unsubscribed from channel:`, channelName);
    }
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribeAll(): Promise<void> {
    for (const [channelName, channel] of this.channels) {
      await this.supabase.removeChannel(channel);
      console.log(`[Realtime] Unsubscribed from channel:`, channelName);
    }
    this.channels.clear();
    this.handlers.clear();
  }

  /**
   * Get active channel names
   */
  getActiveChannels(): string[] {
    return Array.from(this.channels.keys());
  }
}

// React hooks have been moved to './hooks.ts' for client-side usage
// Export the hooks module for backward compatibility
export * from './hooks';

// Singleton instance for server-side use
export const realtimeEmitter = new RealtimeEmitter();