import { Suspense } from 'react';
import { ReadingHistory } from '@/components/readings/reading-history';
import { CustomerSelector } from '@/components/readings/customer-selector';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';

interface PageProps {
  params: { tenant: string };
  searchParams: { customerId?: string };
}

export default async function ReadingHistoryPage({ params, searchParams }: PageProps) {
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

  // Check user role
  const { data: userRole } = await supabase
    .from('user_tenant_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .single();

  const canViewAllReadings = userRole?.role && 
    ['admin', 'manager', 'office_clerk', 'meter_reader'].includes(userRole.role);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold">Reading History</h1>
          <p className="text-muted-foreground">
            View and analyze meter reading data and consumption patterns
          </p>
        </div>

        {canViewAllReadings && (
          <div className="max-w-sm">
            <CustomerSelector 
              tenantId={tenantId}
              value={searchParams.customerId}
              onValueChange={(customerId) => {
                // This will be handled client-side
              }}
            />
          </div>
        )}
      </div>

      <Suspense fallback={<HistoryLoadingSkeleton />}>
        <ReadingHistory 
          customerId={searchParams.customerId}
          tenantId={tenantId}
        />
      </Suspense>
    </div>
  );
}

function HistoryLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}