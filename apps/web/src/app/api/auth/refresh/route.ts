import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Refresh the session
    const { data: sessionData, error: sessionError } = await supabase.auth.refreshSession()
    
    if (sessionError || !sessionData.session) {
      return NextResponse.json(
        { 
          error: 'Session refresh failed',
          message: 'Unable to refresh session. Please log in again.'
        },
        { status: 401 }
      )
    }
    
    // Get updated user data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select(`
        *,
        tenant:tenants(*)
      `)
      .eq('auth_user_id', sessionData.user?.id)
      .single()
    
    if (userError || !userData) {
      return NextResponse.json(
        { 
          error: 'User not found',
          message: 'User account not found'
        },
        { status: 404 }
      )
    }
    
    // Log session refresh
    await supabase.rpc('log_auth_event', {
      p_event_type: 'session_refresh',
      p_user_id: sessionData.user?.id,
      p_tenant_id: userData.tenant_id,
      p_ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      p_user_agent: request.headers.get('user-agent')
    })
    
    return NextResponse.json({
      success: true,
      message: 'Session refreshed successfully',
      data: {
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
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
          expires_at: sessionData.session.expires_at,
          expires_in: sessionData.session.expires_in
        }
      }
    })
    
  } catch (error) {
    console.error('Session refresh error:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: 'An unexpected error occurred. Please try again.'
      },
      { status: 500 }
    )
  }
}