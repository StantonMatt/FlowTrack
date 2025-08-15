import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  RealtimeEmitter, 
  RealtimeSubscriber, 
  RealtimeEventType,
  type RealtimeMessage,
  type ReadingEventPayload
} from '../events';

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    channel: vi.fn(),
    removeChannel: vi.fn(),
  })),
}));

describe('RealtimeEmitter', () => {
  let emitter: RealtimeEmitter;
  let mockSupabase: any;
  let mockChannel: any;

  beforeEach(() => {
    emitter = new RealtimeEmitter();
    mockSupabase = (emitter as any).supabase;
    
    // Mock channel
    mockChannel = {
      send: vi.fn().mockResolvedValue({ error: null }),
    };
    
    mockSupabase.channel = vi.fn().mockReturnValue(mockChannel);
  });

  describe('emitReadingInsert', () => {
    it('should emit reading insert event with correct structure', async () => {
      const payload: ReadingEventPayload = {
        readingId: 'reading-123',
        customerId: 'customer-456',
        readingValue: 1234,
        readingDate: '2024-01-15',
        consumption: 100,
        anomalyFlag: false,
      };

      await emitter.emitReadingInsert('tenant-789', payload, 'user-123');

      expect(mockSupabase.channel).toHaveBeenCalledWith('tenant:tenant-789:readings');
      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: RealtimeEventType.READING_INSERT,
        payload: expect.objectContaining({
          type: RealtimeEventType.READING_INSERT,
          tenantId: 'tenant-789',
          payload,
          userId: 'user-123',
          timestamp: expect.any(String),
          correlationId: expect.any(String),
        }),
      });
    });

    it('should handle broadcast errors', async () => {
      mockChannel.send.mockResolvedValue({ error: new Error('Broadcast failed') });

      const payload: ReadingEventPayload = {
        readingId: 'reading-123',
        customerId: 'customer-456',
        readingValue: 1234,
        readingDate: '2024-01-15',
        consumption: null,
        anomalyFlag: false,
      };

      await expect(
        emitter.emitReadingInsert('tenant-789', payload)
      ).rejects.toThrow();
    });
  });

  describe('emitAnomalyDetected', () => {
    it('should emit anomaly event to correct channel', async () => {
      const payload = {
        readingId: 'reading-123',
        customerId: 'customer-456',
        anomalyType: 'high_consumption',
        severity: 'high' as const,
        details: { consumption: 5000, threshold: 1000 },
      };

      await emitter.emitAnomalyDetected('tenant-789', payload, 'user-123');

      expect(mockSupabase.channel).toHaveBeenCalledWith('tenant:tenant-789:anomalies');
      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: RealtimeEventType.ANOMALY_DETECTED,
        payload: expect.objectContaining({
          type: RealtimeEventType.ANOMALY_DETECTED,
          tenantId: 'tenant-789',
          payload,
        }),
      });
    });
  });

  describe('emitCustom', () => {
    it('should emit custom events to specified channel', async () => {
      const payload = { custom: 'data' };

      await emitter.emitCustom(
        'custom-channel',
        'custom.event',
        payload,
        'tenant-123',
        'user-456'
      );

      expect(mockSupabase.channel).toHaveBeenCalledWith('custom-channel');
      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'custom.event',
        payload: expect.objectContaining({
          type: 'custom.event',
          tenantId: 'tenant-123',
          payload,
          userId: 'user-456',
        }),
      });
    });
  });
});

describe('RealtimeSubscriber', () => {
  let subscriber: RealtimeSubscriber;
  let mockSupabase: any;
  let mockChannel: any;

  beforeEach(() => {
    subscriber = new RealtimeSubscriber();
    mockSupabase = (subscriber as any).supabase;
    
    // Mock channel
    mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockImplementation((callback) => {
        callback('subscribed');
        return mockChannel;
      }),
    };
    
    mockSupabase.channel = vi.fn().mockReturnValue(mockChannel);
    mockSupabase.removeChannel = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await subscriber.unsubscribeAll();
  });

  describe('subscribeToReadings', () => {
    it('should subscribe to tenant readings channel', () => {
      const handler = vi.fn();
      const unsubscribe = subscriber.subscribeToReadings('tenant-123', handler);

      expect(mockSupabase.channel).toHaveBeenCalledWith('tenant:tenant-123:readings');
      expect(mockChannel.on).toHaveBeenCalledWith(
        'broadcast',
        { event: '*' },
        expect.any(Function)
      );
      expect(mockChannel.subscribe).toHaveBeenCalled();

      expect(typeof unsubscribe).toBe('function');
    });

    it('should handle incoming messages', () => {
      const handler = vi.fn();
      subscriber.subscribeToReadings('tenant-123', handler);

      // Get the broadcast handler
      const broadcastHandler = mockChannel.on.mock.calls[0][2];
      
      // Simulate incoming message
      const message: RealtimeMessage<ReadingEventPayload> = {
        type: RealtimeEventType.READING_INSERT,
        tenantId: 'tenant-123',
        timestamp: new Date().toISOString(),
        payload: {
          readingId: 'reading-456',
          customerId: 'customer-789',
          readingValue: 1234,
          readingDate: '2024-01-15',
          consumption: 100,
          anomalyFlag: false,
        },
      };

      broadcastHandler({ payload: message });

      expect(handler).toHaveBeenCalledWith(message);
    });

    it('should reuse channel for multiple handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      subscriber.subscribeToReadings('tenant-123', handler1);
      subscriber.subscribeToReadings('tenant-123', handler2);

      // Should only create channel once
      expect(mockSupabase.channel).toHaveBeenCalledTimes(1);

      // Both handlers should receive messages
      const broadcastHandler = mockChannel.on.mock.calls[0][2];
      const message = { 
        type: RealtimeEventType.READING_INSERT,
        payload: { test: 'data' },
      };
      
      broadcastHandler({ payload: message });

      expect(handler1).toHaveBeenCalledWith(message);
      expect(handler2).toHaveBeenCalledWith(message);
    });
  });

  describe('subscribeToAnomalies', () => {
    it('should subscribe to tenant anomalies channel', () => {
      const handler = vi.fn();
      const unsubscribe = subscriber.subscribeToAnomalies('tenant-123', handler);

      expect(mockSupabase.channel).toHaveBeenCalledWith('tenant:tenant-123:anomalies');
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('unsubscribe', () => {
    it('should remove handler when unsubscribe is called', () => {
      const handler = vi.fn();
      const unsubscribe = subscriber.subscribeToReadings('tenant-123', handler);

      // Verify subscription
      expect(subscriber.getActiveChannels()).toContain('tenant:tenant-123:readings');

      // Unsubscribe
      unsubscribe();

      // Channel should be removed when last handler is removed
      expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
    });

    it('should not remove channel if other handlers exist', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = subscriber.subscribeToReadings('tenant-123', handler1);
      const unsubscribe2 = subscriber.subscribeToReadings('tenant-123', handler2);

      // Unsubscribe first handler
      unsubscribe1();

      // Channel should not be removed
      expect(mockSupabase.removeChannel).not.toHaveBeenCalled();

      // Unsubscribe second handler
      unsubscribe2();

      // Now channel should be removed
      expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
    });
  });

  describe('unsubscribeAll', () => {
    it('should unsubscribe from all channels', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      subscriber.subscribeToReadings('tenant-123', handler1);
      subscriber.subscribeToAnomalies('tenant-456', handler2);

      expect(subscriber.getActiveChannels()).toHaveLength(2);

      await subscriber.unsubscribeAll();

      expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(2);
      expect(subscriber.getActiveChannels()).toHaveLength(0);
    });
  });

  describe('getActiveChannels', () => {
    it('should return list of active channel names', () => {
      const handler = vi.fn();

      subscriber.subscribeToReadings('tenant-123', handler);
      subscriber.subscribeToAnomalies('tenant-123', handler);
      subscriber.subscribe('custom-channel', handler);

      const channels = subscriber.getActiveChannels();

      expect(channels).toContain('tenant:tenant-123:readings');
      expect(channels).toContain('tenant:tenant-123:anomalies');
      expect(channels).toContain('custom-channel');
      expect(channels).toHaveLength(3);
    });
  });
});

describe('Message deduplication', () => {
  it('should deduplicate messages by correlationId', () => {
    const subscriber = new RealtimeSubscriber();
    const mockSupabase = (subscriber as any).supabase;
    
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };
    
    mockSupabase.channel = vi.fn().mockReturnValue(mockChannel);

    const handler = vi.fn();
    const processedIds = new Set<string>();

    // Wrapper to handle deduplication
    const dedupHandler = (message: RealtimeMessage) => {
      if (message.correlationId && !processedIds.has(message.correlationId)) {
        processedIds.add(message.correlationId);
        handler(message);
      }
    };

    subscriber.subscribe('test-channel', dedupHandler);

    const broadcastHandler = mockChannel.on.mock.calls[0][2];
    
    // Send same message twice
    const message = {
      type: 'test',
      tenantId: 'tenant-123',
      timestamp: new Date().toISOString(),
      payload: { test: 'data' },
      correlationId: 'same-id',
    };

    broadcastHandler({ payload: message });
    broadcastHandler({ payload: message });

    // Handler should only be called once
    expect(handler).toHaveBeenCalledTimes(1);
  });
});