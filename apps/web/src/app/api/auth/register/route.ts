import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@supabase/ssr'

// Validation schema
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  organizationName: z.string().min(2, 'Organization name is required'),
  subdomain: z.string()
    .min(3, 'Subdomain must be at least 3 characters')
    .max(63, 'Subdomain must be less than 63 characters')
    .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'Invalid subdomain format'),
  phone: z.string().optional(),
  acceptTerms: z.boolean().refine(val => val === true, 'You must accept the terms and conditions')
})

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json()
    const validatedData = registerSchema.parse(body)
    
    // Create admin Supabase client for privileged operations
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
    
    // Check if subdomain is already taken
    const { data: existingTenant } = await adminClient
      .from('tenants')
      .select('id')
      .eq('subdomain', validatedData.subdomain)
      .single()
    
    if (existingTenant) {
      return NextResponse.json(
        { 
          error: 'Subdomain already taken',
          message: 'This subdomain is already in use. Please choose another one.'
        },
        { status: 400 }
      )
    }
    
    // Check if email is already registered
    const { data: existingUser } = await adminClient
      .from('users')
      .select('id')
      .eq('email', validatedData.email)
      .single()
    
    if (existingUser) {
      return NextResponse.json(
        { 
          error: 'Email already registered',
          message: 'An account with this email already exists.'
        },
        { status: 400 }
      )
    }
    
    // Start transaction by creating tenant first
    const { data: tenant, error: tenantError } = await adminClient
      .from('tenants')
      .insert({
        name: validatedData.organizationName,
        subdomain: validatedData.subdomain,
        settings: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          currency: 'USD',
          locale: 'en-US'
        },
        billing_settings: {
          billing_cycle: 'monthly',
          payment_terms: 30,
          late_fee_percentage: 1.5
        },
        branding: {
          primary_color: '#0066CC',
          company_phone: validatedData.phone
        }
      })
      .select()
      .single()
    
    if (tenantError || !tenant) {
      console.error('Tenant creation error:', tenantError)
      return NextResponse.json(
        { 
          error: 'Registration failed',
          message: 'Failed to create organization. Please try again.'
        },
        { status: 500 }
      )
    }
    
    // Create auth user with metadata
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: validatedData.email,
      password: validatedData.password,
      email_confirm: false, // Set to true in production with email verification
      user_metadata: {
        full_name: validatedData.fullName,
        tenant_id: tenant.id,
        role: 'admin',
        subdomain: tenant.subdomain
      },
      app_metadata: {
        tenant_id: tenant.id,
        role: 'admin',
        subdomain: tenant.subdomain
      }
    })
    
    if (authError || !authData.user) {
      // Rollback: Delete the tenant if user creation fails
      await adminClient
        .from('tenants')
        .delete()
        .eq('id', tenant.id)
      
      console.error('Auth user creation error:', authError)
      return NextResponse.json(
        { 
          error: 'Registration failed',
          message: 'Failed to create user account. Please try again.'
        },
        { status: 500 }
      )
    }
    
    // The trigger will automatically create the user record in the users table
    // Log the registration event
    await adminClient.rpc('log_auth_event', {
      p_event_type: 'register',
      p_user_id: authData.user.id,
      p_tenant_id: tenant.id,
      p_event_data: {
        email: validatedData.email,
        subdomain: validatedData.subdomain,
        organization: validatedData.organizationName
      },
      p_ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      p_user_agent: request.headers.get('user-agent')
    })
    
    // Send confirmation email (in production)
    if (process.env.NODE_ENV === 'production') {
      // This would trigger Supabase's email confirmation
      // The email templates should be configured in Supabase dashboard
    }
    
    return NextResponse.json({
      success: true,
      message: 'Registration successful! Please check your email to verify your account.',
      data: {
        subdomain: tenant.subdomain,
        loginUrl: `https://${tenant.subdomain}.${process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'}/login`
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
    
    console.error('Registration error:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: 'An unexpected error occurred. Please try again.'
      },
      { status: 500 }
    )
  }
}