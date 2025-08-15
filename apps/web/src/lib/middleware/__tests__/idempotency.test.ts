import { describe, it, expect, beforeEach, vi } from 'vitest';
import { withIdempotency } from '../idempotency';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Mock Supabase client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock crypto
global.crypto = {
  randomUUID: vi.fn(() => 'test-uuid'),
  subtle: {
    digest: vi.fn(async (algo, data) => new ArrayBuffer(32)),
  },
} as any;

describe('IdempotencyMiddleware', () => {
  let mockSupabase: any;
  let mockRequest: NextRequest;
  let mockHandler: vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };
    
    vi.mocked(createClient).mockResolvedValue(mockSupabase);
    
    mockHandler = vi.fn();
    
    // Create mock request
    mockRequest = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ test: 'data' }),
    });
  });

  describe('Basic functionality', () => {
    it('should process request without idempotency key', async () => {
      const response = NextResponse.json({ success: true });
      mockHandler.mockResolvedValue(response);

      const result = await withIdempotency(mockRequest, mockHandler);

      expect(mockHandler).toHaveBeenCalledWith(mockRequest);
      expect(result).toBe(response);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should process request with new idempotency key', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      // No existing key in database
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      
      // Insert successful
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'record-id' },
        error: null,
      });
      
      const response = NextResponse.json({ success: true });
      mockHandler.mockResolvedValue(response);

      const result = await withIdempotency(mockRequest, mockHandler);

      expect(mockHandler).toHaveBeenCalledWith(mockRequest);
      expect(result.status).toBe(200);
      
      // Should have inserted idempotency record
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'test-key-123',
          request_path: '/api/test',
          status: 'processing',
        })
      );
    });

    it('should return cached response for duplicate request', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      const cachedResponse = {
        body: JSON.stringify({ cached: true }),
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      };
      
      // Existing key with completed response
      mockSupabase.single.mockResolvedValue({
        data: {
          id: 'record-id',
          key: 'test-key-123',
          status: 'completed',
          response_body: cachedResponse.body,
          response_status: cachedResponse.status,
          response_headers: cachedResponse.headers,
        },
        error: null,
      });

      const result = await withIdempotency(mockRequest, mockHandler);

      // Handler should NOT be called
      expect(mockHandler).not.toHaveBeenCalled();
      
      // Should return cached response
      const json = await result.json();
      expect(json).toEqual({ cached: true });
      expect(result.status).toBe(201);
    });

    it('should handle concurrent requests with same key', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      // First check: no existing key
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      
      // Insert fails due to unique constraint (concurrent request)
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505' }, // Unique violation
      });
      
      // Retry: find processing request
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'record-id',
          status: 'processing',
        },
        error: null,
      });
      
      // Poll for completion
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'record-id',
          status: 'completed',
          response_body: JSON.stringify({ result: 'data' }),
          response_status: 200,
          response_headers: {},
        },
        error: null,
      });

      const result = await withIdempotency(mockRequest, mockHandler);

      // Handler should NOT be called (other request is processing)
      expect(mockHandler).not.toHaveBeenCalled();
      
      const json = await result.json();
      expect(json).toEqual({ result: 'data' });
    });
  });

  describe('Hash validation', () => {
    it('should reject request with same key but different body', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      // Existing key with different hash
      mockSupabase.single.mockResolvedValue({
        data: {
          id: 'record-id',
          key: 'test-key-123',
          body_hash: 'different-hash',
          status: 'completed',
        },
        error: null,
      });

      const result = await withIdempotency(mockRequest, mockHandler);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(result.status).toBe(409);
      
      const json = await result.json();
      expect(json.error).toContain('different request body');
    });
  });

  describe('TTL and cleanup', () => {
    it('should ignore expired idempotency keys', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      const expiredDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      
      // Existing but expired key
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'record-id',
          key: 'test-key-123',
          created_at: expiredDate.toISOString(),
          expires_at: new Date(expiredDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        },
        error: null,
      });
      
      // Insert new record
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'new-record-id' },
        error: null,
      });
      
      const response = NextResponse.json({ fresh: true });
      mockHandler.mockResolvedValue(response);

      const result = await withIdempotency(mockRequest, mockHandler);

      expect(mockHandler).toHaveBeenCalled();
      expect(result.status).toBe(200);
    });

    it('should clean up old records periodically', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      // No existing key
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      
      // Insert successful
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'record-id' },
        error: null,
      });
      
      // Cleanup query
      mockSupabase.delete.mockResolvedValue({
        error: null,
      });
      
      const response = NextResponse.json({ success: true });
      mockHandler.mockResolvedValue(response);

      // Force cleanup by manipulating lastCleanup time
      const middleware = { lastCleanup: Date.now() - 2 * 60 * 60 * 1000 }; // 2 hours ago
      
      await withIdempotency(mockRequest, mockHandler);

      // Should have attempted cleanup
      expect(mockSupabase.delete).toHaveBeenCalled();
    });
  });

  describe('Custom options', () => {
    it('should use custom TTL', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'record-id' },
        error: null,
      });
      
      const response = NextResponse.json({ success: true });
      mockHandler.mockResolvedValue(response);

      await withIdempotency(mockRequest, mockHandler, { ttl: 3600 }); // 1 hour

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          expires_at: expect.any(String),
        })
      );
      
      // Check that expires_at is approximately 1 hour from now
      const insertCall = mockSupabase.insert.mock.calls[0][0];
      const expiresAt = new Date(insertCall.expires_at);
      const expectedExpiry = new Date(Date.now() + 3600 * 1000);
      const diff = Math.abs(expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(5000); // Within 5 seconds
    });

    it('should use custom prefix', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'record-id' },
        error: null,
      });
      
      const response = NextResponse.json({ success: true });
      mockHandler.mockResolvedValue(response);

      await withIdempotency(mockRequest, mockHandler, { prefix: 'custom' });

      expect(mockSupabase.eq).toHaveBeenCalledWith('key', 'custom:test-key-123');
    });

    it('should handle tenant-scoped idempotency', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      mockRequest.headers.set('X-Tenant-Id', 'tenant-456');
      
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'record-id' },
        error: null,
      });
      
      const response = NextResponse.json({ success: true });
      mockHandler.mockResolvedValue(response);

      await withIdempotency(mockRequest, mockHandler);

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant-456',
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle handler errors correctly', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'record-id' },
        error: null,
      });
      
      const error = new Error('Handler failed');
      mockHandler.mockRejectedValue(error);

      await expect(withIdempotency(mockRequest, mockHandler)).rejects.toThrow('Handler failed');

      // Should update status to failed
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error_message: 'Handler failed',
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      // Database error on initial check
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: new Error('Database unavailable'),
      });
      
      const response = NextResponse.json({ success: true });
      mockHandler.mockResolvedValue(response);

      // Should still process request when database is unavailable
      const result = await withIdempotency(mockRequest, mockHandler);

      expect(mockHandler).toHaveBeenCalled();
      expect(result).toBe(response);
    });

    it('should timeout waiting for concurrent request', async () => {
      mockRequest.headers.set('Idempotency-Key', 'test-key-123');
      
      // Always return processing status (simulating stuck request)
      mockSupabase.single.mockResolvedValue({
        data: {
          id: 'record-id',
          status: 'processing',
        },
        error: null,
      });

      // Mock setTimeout to speed up test
      vi.useFakeTimers();
      
      const resultPromise = withIdempotency(mockRequest, mockHandler, { 
        maxWaitTime: 1000 
      });
      
      // Fast-forward time
      await vi.advanceTimersByTimeAsync(1500);
      
      const result = await resultPromise;
      
      vi.useRealTimers();

      expect(result.status).toBe(409);
      const json = await result.json();
      expect(json.error).toContain('Request is still processing');
    });
  });
});