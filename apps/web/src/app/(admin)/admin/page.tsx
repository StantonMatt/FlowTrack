import { Metadata } from 'next'
import { cookies } from 'next/headers'
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
  const cookieStore = await cookies()
  const isDemoMode = cookieStore.get('demo_auth')?.value === 'true'
  
  // Return demo dashboard if in demo mode
  if (isDemoMode) {
    return (
      <div className="flex flex-col p-6">
        <h1 className="text-3xl font-bold mb-6">Dashboard (Demo Mode)</h1>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Total Customers</div>
            <div className="text-2xl font-bold">1,234</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Readings Today</div>
            <div className="text-2xl font-bold">89</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Revenue This Month</div>
            <div className="text-2xl font-bold">$45,678</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Overdue Invoices</div>
            <div className="text-2xl font-bold text-red-600">12</div>
          </div>
        </div>
        <p className="text-gray-600">
          This is a demo mode. Login with real credentials to see actual data.
        </p>
      </div>
    )
  }
  
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