import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/supabase';
import { 
  rateLimit as createRateLimit, 
  rateLimitResponse,
  validatePayloadSize,
  RATE_LIMITS,
  PAYLOAD_LIMITS,
  generateRequestId,
  addSecurityHeaders,
  redactPII,
} from './rate-limit';

// ============================================
// TYPES
// ============================================

export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  tenant_id: string;
  role: UserRole;
  full_name?: string;
}

export interface ApiContext {
  user: AuthUser;
  supabase: ReturnType<typeof createServerClient<Database>>;
  tenantId: string;
}

// ============================================
// SUPABASE CLIENT FACTORY
// ============================================

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            // Handle cookie errors in middleware
          }
        },
        remove(name: string, options: any) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch (error) {
            // Handle cookie errors in middleware
          }
        },
      },
    }
  );
}

// ============================================
// AUTH MIDDLEWARE
// ============================================

export async function withAuth(
  handler: (req: NextRequest, context: ApiContext) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    try {
      const supabase = createSupabaseServerClient();
      
      // Get session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }

      // Get user details from our users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .single();

      if (userError || !userData) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 401 }
        );
      }

      const user: AuthUser = {
        id: userData.id,
        email: userData.email,
        tenant_id: userData.tenant_id,
        role: userData.role as UserRole,
        full_name: userData.full_name || undefined,
      };

      const context: ApiContext = {
        user,
        supabase,
        tenantId: userData.tenant_id,
      };

      return handler(req, context);
    } catch (error) {
      console.error('Auth middleware error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

// ============================================
// ROLE-BASED ACCESS CONTROL
// ============================================

const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 4,
  manager: 3,
  operator: 2,
  viewer: 1,
};

export function hasPermission(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function withRole(requiredRole: UserRole) {
  return (
    handler: (req: NextRequest, context: ApiContext) => Promise<NextResponse>
  ) => {
    return withAuth(async (req, context) => {
      if (!hasPermission(context.user.role, requiredRole)) {
        return NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        );
      }
      return handler(req, context);
    });
  };
}

// ============================================
// TENANT SCOPING UTILITIES
// ============================================

export function scopeToTenant<T extends { tenant_id?: string }>(
  query: any,
  tenantId: string
) {
  return query.eq('tenant_id', tenantId);
}

export function validateTenantAccess(
  record: { tenant_id: string },
  tenantId: string
): boolean {
  return record.tenant_id === tenantId;
}

// ============================================
// REQUEST VALIDATION
// ============================================

export async function parseAndValidateBody<T>(
  req: NextRequest,
  schema: any
): Promise<{ data?: T; error?: string }> {
  try {
    const body = await req.json();
    const validated = schema.parse(body);
    return { data: validated };
  } catch (error: any) {
    if (error.errors) {
      const firstError = error.errors[0];
      return { error: `${firstError.path.join('.')}: ${firstError.message}` };
    }
    return { error: 'Invalid request body' };
  }
}

// ============================================
// ENHANCED RATE LIMITING WITH SECURITY
// ============================================

export function withRateLimit(config = RATE_LIMITS.read) {
  return (
    handler: (req: NextRequest, context: ApiContext) => Promise<NextResponse>
  ) => {
    return withAuth(async (req, context) => {
      // Generate request ID for tracking
      const requestId = generateRequestId();
      
      // Check payload size
      const sizeCheck = await validatePayloadSize(req, PAYLOAD_LIMITS.json);
      if (!sizeCheck.valid) {
        return NextResponse.json(
          { error: sizeCheck.error, request_id: requestId },
          { status: 413 }
        );
      }
      
      // Apply rate limiting
      const rateLimiter = createRateLimit(config);
      const identifier = `${context.tenantId}:${context.user.id}`;
      const rateLimitResult = await rateLimiter(req, identifier);
      
      const errorResponse = rateLimitResponse(rateLimitResult);
      if (errorResponse) {
        return addSecurityHeaders(errorResponse);
      }
      
      // Log request (with PII redacted)
      console.log({
        request_id: requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        user_id: context.user.id,
        tenant_id: context.tenantId,
        timestamp: new Date().toISOString(),
      });
      
      // Execute handler
      const response = await handler(req, context);
      
      // Add security headers and request ID
      response.headers.set('X-Request-Id', requestId);
      return addSecurityHeaders(response);
    });
  };
}

// Specific rate limit wrappers for different operation types
export const withReadRateLimit = () => withRateLimit(RATE_LIMITS.read);
export const withWriteRateLimit = () => withRateLimit(RATE_LIMITS.write);
export const withImportRateLimit = () => withRateLimit(RATE_LIMITS.import);
export const withExportRateLimit = () => withRateLimit(RATE_LIMITS.export);

// ============================================
// ERROR HANDLING
// ============================================

export function handleApiError(error: any): NextResponse {
  console.error('API Error:', error);

  if (error.code === '23505') {
    return NextResponse.json(
      { error: 'Duplicate entry' },
      { status: 409 }
    );
  }

  if (error.code === '23503') {
    return NextResponse.json(
      { error: 'Referenced record not found' },
      { status: 400 }
    );
  }

  if (error.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Record not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { error: error.message || 'Internal server error' },
    { status: 500 }
  );
}

// ============================================
// RESPONSE HELPERS
// ============================================

export function jsonResponse<T>(
  data: T,
  status: number = 200
): NextResponse {
  return NextResponse.json(data, { status });
}

export function successResponse<T>(data: T): NextResponse {
  return jsonResponse({ success: true, data }, 200);
}

export function errorResponse(
  message: string,
  status: number = 400
): NextResponse {
  return jsonResponse({ success: false, error: message }, status);
}