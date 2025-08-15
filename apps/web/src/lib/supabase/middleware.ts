import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { Database } from '@/types/database.types'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // This will refresh session if expired - required for Server Components
  const { data: { user }, error } = await supabase.auth.getUser()

  // Set user ID in headers if authenticated
  if (user) {
    supabaseResponse.headers.set('x-user-id', user.id)
  }

  // Get tenant information from subdomain
  const hostname = request.headers.get('host') || ''
  const subdomain = hostname.split('.')[0]
  
  // If authenticated and has tenant access, add tenant info to headers
  if (user && subdomain && subdomain !== 'localhost' && subdomain !== 'app') {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, subdomain')
      .eq('subdomain', subdomain)
      .single()
    
    if (tenant) {
      supabaseResponse.headers.set('x-tenant-id', tenant.id)
      supabaseResponse.headers.set('x-tenant-subdomain', tenant.subdomain)
    }
  }

  return supabaseResponse
}