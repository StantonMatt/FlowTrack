import { LRUCache } from 'lru-cache';
import { NextRequest, NextResponse } from 'next/server';

// ============================================
// RATE LIMITING CONFIGURATION
// ============================================

export interface RateLimitConfig {
  interval: number; // Time window in milliseconds
  uniqueTokenPerInterval: number; // Max number of unique tokens per interval
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: Date;
}

// Default configurations for different endpoint types
export const RATE_LIMITS = {
  // Strict limits for write operations
  write: {
    interval: 60 * 1000, // 1 minute
    uniqueTokenPerInterval: 10, // 10 requests per minute
  },
  // Moderate limits for read operations
  read: {
    interval: 60 * 1000, // 1 minute
    uniqueTokenPerInterval: 100, // 100 requests per minute
  },
  // Strict limits for import operations
  import: {
    interval: 60 * 60 * 1000, // 1 hour
    uniqueTokenPerInterval: 5, // 5 imports per hour
  },
  // Moderate limits for export operations
  export: {
    interval: 60 * 1000, // 1 minute
    uniqueTokenPerInterval: 20, // 20 exports per minute
  },
  // Very strict limits for auth operations
  auth: {
    interval: 15 * 60 * 1000, // 15 minutes
    uniqueTokenPerInterval: 10, // 10 attempts per 15 minutes
  },
};

// ============================================
// TOKEN BUCKET IMPLEMENTATION
// ============================================

class TokenBucket {
  private cache: LRUCache<string, number[]>;
  private interval: number;
  private uniqueTokenPerInterval: number;

  constructor(config: RateLimitConfig) {
    this.interval = config.interval;
    this.uniqueTokenPerInterval = config.uniqueTokenPerInterval;
    this.cache = new LRUCache<string, number[]>({
      max: 10000, // Store up to 10k unique tokens
      ttl: config.interval, // Auto-expire after interval
    });
  }

  check(token: string): RateLimitResult {
    const now = Date.now();
    const timestamps = this.cache.get(token) || [];
    
    // Filter out timestamps outside the current window
    const validTimestamps = timestamps.filter(
      (timestamp) => now - timestamp < this.interval
    );

    if (validTimestamps.length >= this.uniqueTokenPerInterval) {
      // Rate limit exceeded
      return {
        success: false,
        limit: this.uniqueTokenPerInterval,
        remaining: 0,
        reset: new Date(validTimestamps[0] + this.interval),
      };
    }

    // Add current timestamp and update cache
    validTimestamps.push(now);
    this.cache.set(token, validTimestamps);

    return {
      success: true,
      limit: this.uniqueTokenPerInterval,
      remaining: this.uniqueTokenPerInterval - validTimestamps.length,
      reset: new Date(now + this.interval),
    };
  }

  reset(token: string): void {
    this.cache.delete(token);
  }
}

// ============================================
// RATE LIMITER INSTANCES
// ============================================

const rateLimiters = new Map<string, TokenBucket>();

function getRateLimiter(key: string, config: RateLimitConfig): TokenBucket {
  if (!rateLimiters.has(key)) {
    rateLimiters.set(key, new TokenBucket(config));
  }
  return rateLimiters.get(key)!;
}

// ============================================
// RATE LIMITING MIDDLEWARE
// ============================================

export function rateLimit(
  config: RateLimitConfig = RATE_LIMITS.read
) {
  return async (
    req: NextRequest,
    identifier?: string
  ): Promise<RateLimitResult> => {
    // Generate identifier from IP, user ID, or custom identifier
    const token = identifier || 
      req.headers.get('x-forwarded-for') || 
      req.headers.get('x-real-ip') || 
      'anonymous';
    
    // Get or create rate limiter for this endpoint
    const limiterKey = `${req.nextUrl.pathname}:${config.interval}`;
    const limiter = getRateLimiter(limiterKey, config);
    
    return limiter.check(token);
  };
}

// ============================================
// RATE LIMITING RESPONSE HELPER
// ============================================

export function rateLimitResponse(result: RateLimitResult): NextResponse | null {
  if (result.success) {
    return null; // Continue with request
  }

  return NextResponse.json(
    {
      error: 'Too many requests',
      message: `Rate limit exceeded. Please try again after ${result.reset.toISOString()}`,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': result.reset.toISOString(),
        'Retry-After': String(Math.ceil((result.reset.getTime() - Date.now()) / 1000)),
      },
    }
  );
}

// ============================================
// PAYLOAD SIZE VALIDATION
// ============================================

export const PAYLOAD_LIMITS = {
  json: 1 * 1024 * 1024, // 1MB for JSON payloads
  file: 10 * 1024 * 1024, // 10MB for file uploads
  import: 5 * 1024 * 1024, // 5MB for import files
};

export async function validatePayloadSize(
  req: NextRequest,
  maxSize: number = PAYLOAD_LIMITS.json
): Promise<{ valid: boolean; error?: string }> {
  const contentLength = req.headers.get('content-length');
  
  if (!contentLength) {
    return { valid: true }; // No content-length header, proceed with caution
  }

  const size = parseInt(contentLength, 10);
  
  if (isNaN(size)) {
    return { 
      valid: false, 
      error: 'Invalid content-length header' 
    };
  }

  if (size > maxSize) {
    return { 
      valid: false, 
      error: `Payload too large. Maximum size is ${maxSize} bytes` 
    };
  }

  return { valid: true };
}

// ============================================
// REQUEST SANITIZATION
// ============================================

export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Remove potential SQL injection patterns
    return input
      .replace(/'/g, "''") // Escape single quotes
      .replace(/--/g, '') // Remove SQL comments
      .replace(/\/\*/g, '') // Remove multi-line comments
      .replace(/\*\//g, '')
      .replace(/;/g, '') // Remove semicolons
      .trim();
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  
  if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[sanitizeInput(key)] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return input;
}

// ============================================
// PII REDACTION FOR LOGGING
// ============================================

export function redactPII(data: any): any {
  if (!data) return data;
  
  const piiFields = [
    'email',
    'phone',
    'ssn',
    'password',
    'credit_card',
    'card_number',
    'cvv',
    'pin',
    'auth_token',
    'api_key',
    'secret',
  ];
  
  if (typeof data === 'string') {
    // Redact email addresses
    data = data.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED_EMAIL]');
    // Redact phone numbers
    data = data.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]');
    // Redact SSN
    data = data.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
    return data;
  }
  
  if (Array.isArray(data)) {
    return data.map(redactPII);
  }
  
  if (data && typeof data === 'object') {
    const redacted: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (piiFields.some(field => key.toLowerCase().includes(field))) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactPII(value);
      }
    }
    return redacted;
  }
  
  return data;
}

// ============================================
// REQUEST ID GENERATION
// ============================================

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// SECURITY HEADERS
// ============================================

export function addSecurityHeaders(response: NextResponse): NextResponse {
  // CORS headers (adjust origins as needed)
  response.headers.set('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // CSP header (adjust as needed)
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' https://*.supabase.co https://maps.googleapis.com;"
  );
  
  return response;
}