import { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getDashboardStats } from '@/lib/database/queries'
import { Breadcrumbs } from '@/components/admin/breadcrumbs'
import { DashboardStats } from '@/components/admin/dashboard-stats'
import { RecentActivity } from '@/components/admin/recent-activity'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Water utility management dashboard'
}

export default async function AdminDashboard() {
  const supabase = await createClient()
  
  // Fetch dashboard statistics
  const stats = await getDashboardStats(supabase)
  
  // Fetch recent activity
  const { data: recentReadings } = await supabase
    .from('meter_readings')
    .select(`
      id,
      reading,
      reading_date,
      status,
      customer:customers(
        full_name,
        account_number
      )
    `)
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: recentInvoices } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      total_amount,
      status,
      issued_at,
      customer:customers(
        full_name,
        account_number
      )
    `)
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div className="flex flex-col">
      <Breadcrumbs />
      
      <div className="flex-1 space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here's an overview of your water utility.
          </p>
        </div>

        <DashboardStats stats={stats} />

        <div className="grid gap-6 md:grid-cols-2">
          <RecentActivity 
            title="Recent Readings"
            items={recentReadings || []}
            type="readings"
          />
          <RecentActivity 
            title="Recent Invoices"
            items={recentInvoices || []}
            type="invoices"
          />
        </div>
      </div>
    </div>
  )
}