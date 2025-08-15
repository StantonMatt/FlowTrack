import { MobileEntryForm } from '@/components/readings/mobile-entry-form';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

interface PageProps {
  params: { tenant: string };
}

export default async function ReadingEntryPage({ params }: PageProps) {
  const supabase = await createClient();
  
  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect(`/${params.tenant}/login`);
  }

  const tenantId = user.user_metadata?.tenant_id;
  if (!tenantId) {
    redirect(`/${params.tenant}/login`);
  }

  // Check user role - must have permission to enter readings
  const { data: userRole } = await supabase
    .from('user_tenant_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .single();

  const allowedRoles = ['admin', 'manager', 'office_clerk', 'meter_reader'];
  if (!userRole || !allowedRoles.includes(userRole.role)) {
    redirect(`/${params.tenant}/dashboard`);
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Reading Entry</h1>
        <p className="text-muted-foreground">
          Mobile-optimized form for meter reading collection
        </p>
      </div>

      <MobileEntryForm tenantId={tenantId} />
    </div>
  );
}

// Mobile-optimized viewport
export const metadata = {
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
};