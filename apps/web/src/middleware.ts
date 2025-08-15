import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Reserved subdomains that should not be treated as tenant subdomains
const RESERVED_SUBDOMAINS = [
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'auth',
  'login',
  'signup',
  'register',
  'blog',
  'docs',
  'help',
  'support',
  'status',
  'staging',
  'dev',
  'test',
  'demo'
]

// Public paths that don't require authentication
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/auth/confirm'
]

// Demo paths for testing without authentication
const DEMO_PATHS = [
  '/demo'
]

// Static asset paths to skip
const STATIC_PATHS = [
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.json',
  '/api/health'
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Skip middleware for static assets
  if (STATIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  // Update Supabase session
  let response = await updateSession(request)
  
  // Get hostname and extract subdomain
  const hostname = request.headers.get('host') || ''
  const subdomain = getSubdomain(hostname)
  
  // Handle subdomain routing
  if (subdomain) {
    // Add subdomain to headers for downstream use
    response.headers.set('x-tenant-subdomain', subdomain)
    response.headers.set('x-tenant', subdomain) // Alias for compatibility
    
    // Check if subdomain is reserved
    if (RESERVED_SUBDOMAINS.includes(subdomain)) {
      // Redirect reserved subdomains to main domain
      const url = request.nextUrl.clone()
      url.hostname = getMainDomain(hostname)
      return NextResponse.redirect(url)
    }
  } else if (isProductionDomain(hostname) && !pathname.startsWith('/app')) {
    // On production bare domain, show marketing site or redirect to app
    if (pathname === '/' || pathname.startsWith('/marketing')) {
      // Allow marketing pages on bare domain
      return response
    }
    
    // Redirect other paths to app subdomain
    const url = request.nextUrl.clone()
    url.hostname = `app.${hostname}`
    return NextResponse.redirect(url)
  }
  
  // Check authentication for protected routes
  const isDemoPath = DEMO_PATHS.some(path => pathname.startsWith(path))
  
  // Check for demo cookie
  const hasDemoCookie = request.cookies.get('demo_auth')?.value === 'true'
  
  if (!PUBLIC_PATHS.includes(pathname) && !pathname.startsWith('/api/auth') && !isDemoPath) {
    const isAuthenticated = response.headers.get('x-user-id') || hasDemoCookie
    
    if (!isAuthenticated) {
      // Redirect to login with return URL
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('returnUrl', pathname)
      return NextResponse.redirect(url)
    }
    
    // Check tenant access if subdomain is present
    const tenantId = response.headers.get('x-tenant-id')
    const userTenantId = response.headers.get('x-user-tenant-id')
    
    if (subdomain && tenantId && userTenantId && tenantId !== userTenantId) {
      // User doesn't have access to this tenant
      return NextResponse.json(
        { error: 'Access denied', message: 'You do not have access to this organization' },
        { status: 403 }
      )
    }
  }
  
  return response
}

// Helper function to extract subdomain
function getSubdomain(hostname: string): string | null {
  // Handle localhost development
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    // Support subdomain testing via hosts file or header override
    // e.g., tenant1.localhost:3000 or x-test-subdomain header
    const parts = hostname.split('.')
    if (parts.length > 1 && parts[0] !== 'localhost') {
      return parts[0]
    }
    return null
  }
  
  // Handle production domains
  const parts = hostname.split('.')
  
  // Must have at least subdomain.domain.tld
  if (parts.length >= 3) {
    return parts[0]
  }
  
  return null
}

// Helper function to get main domain from hostname
function getMainDomain(hostname: string): string {
  const parts = hostname.split('.')
  
  if (hostname.includes('localhost')) {
    return 'localhost:3000'
  }
  
  // Remove subdomain and return main domain
  if (parts.length >= 3) {
    return parts.slice(1).join('.')
  }
  
  return hostname
}

// Helper function to check if this is a production domain
function isProductionDomain(hostname: string): boolean {
  return !hostname.includes('localhost') && !hostname.includes('127.0.0.1')
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}