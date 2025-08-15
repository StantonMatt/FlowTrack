import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { UserRole } from '@/types/models'
import { can, Permission } from './rbac'

interface AuthContext {
  user: any
  dbUser: any
  tenant: any
  role: UserRole
  tenantId: string
  subdomain: string | null
}

/**
 * Get authenticated user context from request
 */
export async function getAuthContext(request: NextRequest): Promise<AuthContext | null> {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return null
    }
    
    // Get user details with tenant
    const { data: dbUser, error: userError } = await supabase
      .from('users')
      .select(`
        *,
        tenant:tenants(*)
      `)
      .eq('auth_user_id', user.id)
      .single()
    
    if (userError || !dbUser) {
      return null
    }
    
    // Get subdomain from request headers (set by middleware)
    const subdomain = request.headers.get('x-tenant-subdomain')
    
    return {
      user,
      dbUser,
      tenant: dbUser.tenant,
      role: dbUser.role as UserRole,
      tenantId: dbUser.tenant_id,
      subdomain
    }
  } catch (error) {
    console.error('Error getting auth context:', error)
    return null
  }
}

/**
 * Verify tenant access for the current request
 */
export async function verifyTenantAccess(
  request: NextRequest,
  authContext: AuthContext
): Promise<boolean> {
  const subdomain = request.headers.get('x-tenant-subdomain')
  
  // If no subdomain in request, allow (for non-tenant-specific routes)
  if (!subdomain) {
    return true
  }
  
  // Check if user's tenant matches the requested subdomain
  return authContext.tenant.subdomain === subdomain
}

/**
 * Higher-order function to protect API routes
 */
export function withAuth(
  handler: (request: NextRequest, context: AuthContext) => Promise<NextResponse>,
  options?: {
    permission?: Permission
    role?: UserRole
    allowCustomer?: boolean
  }
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    // Get auth context
    const authContext = await getAuthContext(request)
    
    // Check if user is authenticated
    if (!authContext) {
      return NextResponse.json(
        { 
          error: 'Unauthorized',
          message: 'Authentication required'
        },
        { status: 401 }
      )
    }
    
    // Verify tenant access
    const hasAccess = await verifyTenantAccess(request, authContext)
    if (!hasAccess) {
      return NextResponse.json(
        { 
          error: 'Forbidden',
          message: 'You do not have access to this organization'
        },
        { status: 403 }
      )
    }
    
    // Check role requirement
    if (options?.role) {
      const roleHierarchy: Record<UserRole, number> = {
        admin: 4,
        manager: 3,
        operator: 2,
        viewer: 1
      }
      
      if (roleHierarchy[authContext.role] < roleHierarchy[options.role]) {
        return NextResponse.json(
          { 
            error: 'Forbidden',
            message: 'Insufficient role privileges'
          },
          { status: 403 }
        )
      }
    }
    
    // Check permission requirement
    if (options?.permission) {
      if (!can(authContext.role, options.permission)) {
        return NextResponse.json(
          { 
            error: 'Forbidden',
            message: 'You do not have permission to perform this action'
          },
          { status: 403 }
        )
      }
    }
    
    // Call the handler with auth context
    return handler(request, authContext)
  }
}

/**
 * Get current tenant from subdomain or auth context
 */
export async function getCurrentTenant(request: NextRequest) {
  const subdomain = request.headers.get('x-tenant-subdomain')
  
  if (!subdomain) {
    // Try to get from auth context
    const authContext = await getAuthContext(request)
    return authContext?.tenant || null
  }
  
  const supabase = await createClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('subdomain', subdomain)
    .single()
  
  return tenant
}

/**
 * Log an audit event
 */
export async function logAuditEvent(
  eventType: string,
  eventData: any,
  request: NextRequest,
  authContext?: AuthContext | null
) {
  try {
    const supabase = await createClient()
    
    await supabase.rpc('log_auth_event', {
      p_event_type: eventType,
      p_user_id: authContext?.user?.id || null,
      p_tenant_id: authContext?.tenantId || null,
      p_event_data: eventData,
      p_ip_address: request.headers.get('x-forwarded-for') || 
                    request.headers.get('x-real-ip') || 
                    request.ip,
      p_user_agent: request.headers.get('user-agent')
    })
  } catch (error) {
    console.error('Failed to log audit event:', error)
  }
}

/**
 * Validate API request with rate limiting
 */
export async function validateRequest(
  request: NextRequest,
  options?: {
    rateLimit?: {
      requests: number
      window: number // in seconds
    }
  }
) {
  // TODO: Implement rate limiting logic
  // This could use Redis or in-memory store for tracking
  return true
}