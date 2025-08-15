import { BulkEntryGrid } from '@/components/readings/bulk-entry-grid';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

interface PageProps {
  params: { tenant: string };
}

export default async function BulkReadingEntryPage({ params }: PageProps) {
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

  // Check user role - must have permission for bulk operations
  const { data: userRole } = await supabase
    .from('user_tenant_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .single();

  const allowedRoles = ['admin', 'manager', 'office_clerk'];
  if (!userRole || !allowedRoles.includes(userRole.role)) {
    redirect(`/${params.tenant}/dashboard`);
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Bulk Reading Entry</h1>
        <p className="text-muted-foreground">
          Efficiently enter multiple meter readings using grid interface
        </p>
      </div>

      <BulkEntryGrid tenantId={tenantId} />
    </div>
  );
}