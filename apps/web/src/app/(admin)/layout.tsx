import { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Providers } from './providers'
import { AdminShell } from '@/components/admin/admin-shell'

export const metadata: Metadata = {
  title: {
    template: '%s | FlowTrack Admin',
    default: 'Dashboard | FlowTrack Admin'
  },
  description: 'Water utility management system'
}

interface AdminLayoutProps {
  children: React.ReactNode
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  // Check for demo mode first
  const cookieStore = await cookies()
  const isDemoMode = cookieStore.get('demo_auth')?.value === 'true'
  
  if (isDemoMode) {
    // For demo mode, create a fake user object with demo tenant
    const demoUser = {
      id: 'demo-user',
      email: 'demo@flowtrack.app',
      full_name: 'Demo User',
      role: 'admin',
      tenant_id: '11111111-1111-1111-1111-111111111111',
      tenant: {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Demo Water Company',
        subdomain: 'demo',
        is_active: true,
        branding: {
          primary_color: '#0066CC',
          secondary_color: '#00AA55',
          logo_url: '/demo-logo.svg'
        }
      }
    }
    
    const tenantBranding = {
      name: demoUser.tenant.name,
      primaryColor: demoUser.tenant.branding?.primary_color || '#0066CC',
      secondaryColor: demoUser.tenant.branding?.secondary_color,
      logoUrl: demoUser.tenant.branding?.logo_url,
      faviconUrl: demoUser.tenant.branding?.favicon_url
    }
    
    return (
      <Providers 
        tenantBranding={tenantBranding}
        initialUser={{
          id: demoUser.id,
          email: demoUser.email,
          fullName: demoUser.full_name,
          role: demoUser.role,
          tenantId: demoUser.tenant_id
        }}
      >
        <AdminShell 
          user={demoUser}
          tenant={demoUser.tenant}
        >
          {children}
        </AdminShell>
      </Providers>
    )
  }
  
  // Check authentication server-side
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
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
    redirect('/login')
  }

  // Check if user is staff (not a customer)
  const allowedRoles = ['admin', 'manager', 'operator', 'viewer']
  if (!allowedRoles.includes(dbUser.role)) {
    redirect('/unauthorized')
  }

  // Check if tenant is active
  if (!dbUser.tenant.is_active) {
    redirect('/suspended')
  }

  // Pass tenant branding to client
  const tenantBranding = {
    name: dbUser.tenant.name,
    primaryColor: dbUser.tenant.branding?.primary_color || '#0066CC',
    secondaryColor: dbUser.tenant.branding?.secondary_color,
    logoUrl: dbUser.tenant.branding?.logo_url,
    faviconUrl: dbUser.tenant.branding?.favicon_url
  }

  return (
    <Providers 
      tenantBranding={tenantBranding}
      initialUser={{
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.full_name,
        role: dbUser.role,
        tenantId: dbUser.tenant_id
      }}
    >
      <AdminShell 
        user={dbUser}
        tenant={dbUser.tenant}
      >
        {children}
      </AdminShell>
    </Providers>
  )
}