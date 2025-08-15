import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Validation schema
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false)
})

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json()
    const validatedData = loginSchema.parse(body)
    
    // Demo login bypass
    if (validatedData.email === 'demo@flowtrack.app' && validatedData.password === 'demo123456') {
      const response = NextResponse.json({
        success: true,
        message: 'Demo login successful',
        data: {
          user: {
            id: 'demo-user',
            email: 'demo@flowtrack.app',
            fullName: 'Demo User',
            role: 'admin'
          }
        }
      })
      
      // Set demo auth cookie
      response.cookies.set('demo_auth', 'true', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 // 24 hours
      })
      
      return response
    }
    
    // Get Supabase client
    const supabase = await createClient()
    
    // Get subdomain from headers (set by middleware)
    const subdomain = request.headers.get('x-tenant-subdomain')
    
    // Attempt to sign in
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: validatedData.email,
      password: validatedData.password
    })
    
    if (authError || !authData.user) {
      // Log failed login attempt
      await supabase.rpc('log_auth_event', {
        p_event_type: 'login_failed',
        p_event_data: {
          email: validatedData.email,
          error: authError?.message
        },
        p_ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        p_user_agent: request.headers.get('user-agent')
      })
      
      return NextResponse.json(
        { 
          error: 'Authentication failed',
          message: 'Invalid email or password'
        },
        { status: 401 }
      )
    }
    
    // Get user details with tenant info
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select(`
        *,
        tenant:tenants(*)
      `)
      .eq('auth_user_id', authData.user.id)
      .single()
    
    if (userError || !userData) {
      return NextResponse.json(
        { 
          error: 'User not found',
          message: 'User account not properly configured'
        },
        { status: 404 }
      )
    }
    
    // Verify tenant access if subdomain is provided
    if (subdomain && userData.tenant.subdomain !== subdomain) {
      // Log unauthorized access attempt
      await supabase.rpc('log_auth_event', {
        p_event_type: 'unauthorized_access',
        p_user_id: authData.user.id,
        p_tenant_id: userData.tenant_id,
        p_event_data: {
          attempted_subdomain: subdomain,
          user_subdomain: userData.tenant.subdomain
        },
        p_ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        p_user_agent: request.headers.get('user-agent')
      })
      
      return NextResponse.json(
        { 
          error: 'Access denied',
          message: 'You do not have access to this organization'
        },
        { status: 403 }
      )
    }
    
    // Check if user is active
    if (!userData.is_active) {
      return NextResponse.json(
        { 
          error: 'Account disabled',
          message: 'Your account has been disabled. Please contact your administrator.'
        },
        { status: 403 }
      )
    }
    
    // Check if tenant is active
    if (!userData.tenant.is_active) {
      return NextResponse.json(
        { 
          error: 'Organization disabled',
          message: 'This organization has been disabled. Please contact support.'
        },
        { status: 403 }
      )
    }
    
    // Log successful login
    await supabase.rpc('log_auth_event', {
      p_event_type: 'login',
      p_user_id: authData.user.id,
      p_tenant_id: userData.tenant_id,
      p_event_data: {
        email: validatedData.email,
        subdomain: userData.tenant.subdomain,
        remember_me: validatedData.rememberMe
      },
      p_ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      p_user_agent: request.headers.get('user-agent')
    })
    
    // Prepare response data
    const responseData = {
      user: {
        id: userData.id,
        email: userData.email,
        fullName: userData.full_name,
        role: userData.role,
        profile: userData.profile
      },
      tenant: {
        id: userData.tenant.id,
        name: userData.tenant.name,
        subdomain: userData.tenant.subdomain,
        settings: userData.tenant.settings,
        branding: userData.tenant.branding
      },
      session: {
        access_token: authData.session?.access_token,
        refresh_token: authData.session?.refresh_token,
        expires_at: authData.session?.expires_at,
        expires_in: authData.session?.expires_in
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'Login successful',
      data: responseData
    })
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Validation error',
          message: 'Invalid input data',
          errors: error.errors
        },
        { status: 400 }
      )
    }
    
    console.error('Login error:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: 'An unexpected error occurred. Please try again.'
      },
      { status: 500 }
    )
  }
}