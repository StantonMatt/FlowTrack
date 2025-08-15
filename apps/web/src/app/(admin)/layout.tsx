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