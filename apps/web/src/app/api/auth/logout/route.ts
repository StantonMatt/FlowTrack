import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current session to log the logout event
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      // Get user details for logging
      const { data: userData } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('auth_user_id', user.id)
        .single()
      
      // Log logout event
      if (userData) {
        await supabase.rpc('log_auth_event', {
          p_event_type: 'logout',
          p_user_id: user.id,
          p_tenant_id: userData.tenant_id,
          p_ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
          p_user_agent: request.headers.get('user-agent')
        })
      }
    }
    
    // Sign out the user
    const { error } = await supabase.auth.signOut()
    
    if (error) {
      console.error('Logout error:', error)
      return NextResponse.json(
        { 
          error: 'Logout failed',
          message: 'Failed to log out. Please try again.'
        },
        { status: 500 }
      )
    }
    
    return NextResponse.json({
      success: true,
      message: 'Logged out successfully'
    })
    
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: 'An unexpected error occurred. Please try again.'
      },
      { status: 500 }
    )
  }
}