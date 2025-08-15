import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Validation schema
const magicLinkSchema = z.object({
  email: z.string().email('Invalid email address'),
  type: z.enum(['customer', 'staff']).optional().default('customer'),
  redirectTo: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json()
    const validatedData = magicLinkSchema.parse(body)
    
    // Get subdomain from headers
    const subdomain = request.headers.get('x-tenant-subdomain')
    
    if (!subdomain) {
      return NextResponse.json(
        { 
          error: 'Invalid request',
          message: 'Organization context is required'
        },
        { status: 400 }
      )
    }
    
    // Create admin client for checking
    const adminClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() {
            return []
          },
          setAll() {}
        }
      }
    )
    
    // Get tenant by subdomain
    const { data: tenant, error: tenantError } = await adminClient
      .from('tenants')
      .select('id, name')
      .eq('subdomain', subdomain)
      .single()
    
    if (tenantError || !tenant) {
      return NextResponse.json(
        { 
          error: 'Organization not found',
          message: 'The specified organization does not exist'
        },
        { status: 404 }
      )
    }
    
    if (validatedData.type === 'customer') {
      // For customers, check if email exists in customers table
      const { data: customer, error: customerError } = await adminClient
        .from('customers')
        .select('id, status, full_name')
        .eq('tenant_id', tenant.id)
        .eq('email', validatedData.email)
        .single()
      
      if (customerError || !customer) {
        return NextResponse.json(
          { 
            error: 'Access denied',
            message: 'No customer account found with this email address'
          },
          { status: 403 }
        )
      }
      
      if (customer.status !== 'active') {
        return NextResponse.json(
          { 
            error: 'Account inactive',
            message: 'Your customer account is not active. Please contact support.'
          },
          { status: 403 }
        )
      }
    } else {
      // For staff, check if email exists in users table
      const { data: staffUser, error: staffError } = await adminClient
        .from('users')
        .select('id, is_active')
        .eq('tenant_id', tenant.id)
        .eq('email', validatedData.email)
        .single()
      
      if (staffError || !staffUser) {
        return NextResponse.json(
          { 
            error: 'Access denied',
            message: 'No staff account found with this email address'
          },
          { status: 403 }
        )
      }
      
      if (!staffUser.is_active) {
        return NextResponse.json(
          { 
            error: 'Account inactive',
            message: 'Your account is not active. Please contact your administrator.'
          },
          { status: 403 }
        )
      }
    }
    
    // Use regular client for sending magic link
    const supabase = await createClient()
    
    // Construct redirect URL
    const redirectTo = validatedData.redirectTo || 
      `https://${subdomain}.${process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'}/auth/callback`
    
    // Send magic link
    const { error: magicLinkError } = await supabase.auth.signInWithOtp({
      email: validatedData.email,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          tenant_id: tenant.id,
          subdomain: subdomain,
          access_type: validatedData.type
        }
      }
    })
    
    if (magicLinkError) {
      console.error('Magic link error:', magicLinkError)
      return NextResponse.json(
        { 
          error: 'Failed to send magic link',
          message: 'Unable to send login link. Please try again.'
        },
        { status: 500 }
      )
    }
    
    // Log magic link sent event
    await adminClient.rpc('log_auth_event', {
      p_event_type: 'magic_link_sent',
      p_tenant_id: tenant.id,
      p_event_data: {
        email: validatedData.email,
        type: validatedData.type,
        subdomain: subdomain
      },
      p_ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      p_user_agent: request.headers.get('user-agent')
    })
    
    return NextResponse.json({
      success: true,
      message: 'Magic link sent! Please check your email to log in.',
      data: {
        email: validatedData.email,
        type: validatedData.type
      }
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
    
    console.error('Magic link error:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: 'An unexpected error occurred. Please try again.'
      },
      { status: 500 }
    )
  }
}