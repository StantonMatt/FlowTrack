import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export interface IdempotencyOptions {
  ttlSeconds?: number;
  methods?: string[];
  paths?: string[];
}

const DEFAULT_OPTIONS: IdempotencyOptions = {
  ttlSeconds: 24 * 60 * 60, // 24 hours
  methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  paths: ['/api/readings', '/api/customers', '/api/invoices'],
};

/**
 * Idempotency middleware for API routes
 */
export async function withIdempotency(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<NextResponse>,
  options: IdempotencyOptions = {}
): Promise<NextResponse> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check if this request should be handled with idempotency
  if (!shouldHandleIdempotency(request, opts)) {
    return handler(request);
  }

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    return handler(request);
  }

  const tenantId = request.headers.get('X-Tenant-Id');
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Tenant ID required for idempotent requests' },
      { status: 400 }
    );
  }

  const supabase = createClient();

  try {
    // Check for existing idempotency key
    const existing = await checkExistingKey(
      supabase,
      tenantId,
      idempotencyKey,
      request.url
    );

    if (existing) {
      // Return cached response
      return NextResponse.json(
        existing.response_data,
        { 
          status: existing.status_code || 200,
          headers: {
            'X-Idempotent-Replay': 'true',
            'X-Idempotency-Key': idempotencyKey,
          }
        }
      );
    }

    // Store the idempotency key
    const bodyHash = await hashRequestBody(request);
    const expiresAt = new Date(Date.now() + opts.ttlSeconds! * 1000);

    const { error: insertError } = await supabase
      .from('idempotency_keys')
      .insert({
        tenant_id: tenantId,
        key: idempotencyKey,
        request_path: request.url,
        body_hash: bodyHash,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError && insertError.code === '23505') {
      // Duplicate key - race condition, try to fetch again
      const existing = await checkExistingKey(
        supabase,
        tenantId,
        idempotencyKey,
        request.url
      );

      if (existing && existing.response_data) {
        return NextResponse.json(
          existing.response_data,
          { 
            status: existing.status_code || 200,
            headers: {
              'X-Idempotent-Replay': 'true',
              'X-Idempotency-Key': idempotencyKey,
            }
          }
        );
      }
    }

    // Process the request
    const response = await handler(request);
    
    // Store the response for future replays
    if (response.ok) {
      const responseData = await response.clone().json();
      
      await supabase
        .from('idempotency_keys')
        .update({
          response_data: responseData,
          status_code: response.status,
        })
        .eq('tenant_id', tenantId)
        .eq('key', idempotencyKey);
    }

    // Add idempotency headers
    const headers = new Headers(response.headers);
    headers.set('X-Idempotency-Key', idempotencyKey);
    headers.set('X-Idempotent-Replay', 'false');

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('Idempotency middleware error:', error);
    // On error, proceed with normal request handling
    return handler(request);
  }
}

/**
 * Check if request should be handled with idempotency
 */
function shouldHandleIdempotency(
  request: NextRequest,
  options: IdempotencyOptions
): boolean {
  // Check method
  if (options.methods && !options.methods.includes(request.method)) {
    return false;
  }

  // Check path
  if (options.paths) {
    const pathname = new URL(request.url).pathname;
    const shouldHandle = options.paths.some(path => 
      pathname.startsWith(path)
    );
    if (!shouldHandle) {
      return false;
    }
  }

  return true;
}

/**
 * Check for existing idempotency key
 */
async function checkExistingKey(
  supabase: any,
  tenantId: string,
  key: string,
  requestPath: string
): Promise<any> {
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('key', key)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  if (data && data.response_data) {
    // Verify the request path matches
    if (data.request_path !== requestPath) {
      throw new Error('Idempotency key used for different endpoint');
    }
    return data;
  }

  return null;
}

/**
 * Hash request body for comparison
 */
async function hashRequestBody(request: NextRequest): Promise<string> {
  try {
    const body = await request.clone().text();
    return crypto
      .createHash('sha256')
      .update(body)
      .digest('hex');
  } catch {
    return '';
  }
}

/**
 * Generate idempotency key
 */
export function generateIdempotencyKey(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Validate idempotency key format
 */
export function validateIdempotencyKey(key: string): boolean {
  // Should be alphanumeric, hyphens, or underscores, 16-64 characters
  const pattern = /^[a-zA-Z0-9_-]{16,64}$/;
  return pattern.test(key);
}

/**
 * Express-style middleware wrapper for Next.js API routes
 */
export function idempotencyMiddleware(options: IdempotencyOptions = {}) {
  return async function(
    req: NextRequest,
    res: NextResponse,
    next: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    return withIdempotency(req, next, options);
  };
}

/**
 * Hook for client-side idempotency
 */
export function useIdempotency() {
  const generateKey = () => generateIdempotencyKey();
  
  const makeIdempotentRequest = async (
    url: string,
    options: RequestInit & { idempotencyKey?: string } = {}
  ) => {
    const key = options.idempotencyKey || generateKey();
    
    const headers = new Headers(options.headers);
    headers.set('Idempotency-Key', key);
    
    const response = await fetch(url, {
      ...options,
      headers,
    });
    
    return {
      response,
      idempotencyKey: key,
      wasReplayed: response.headers.get('X-Idempotent-Replay') === 'true',
    };
  };
  
  return {
    generateKey,
    makeIdempotentRequest,
  };
}