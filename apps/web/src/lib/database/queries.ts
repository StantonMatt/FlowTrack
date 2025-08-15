import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'
import { 
  Customer, 
  Invoice, 
  MeterReading, 
  CustomerFilter,
  InvoiceFilter,
  MeterReadingFilter,
  PaginationParams,
  PaginatedResponse 
} from '@/types/models'

type Client = SupabaseClient<Database>

// Customer queries
export async function getCustomers(
  client: Client,
  filter?: CustomerFilter,
  pagination?: PaginationParams
): Promise<PaginatedResponse<Customer>> {
  let query = client.from('customers').select('*', { count: 'exact' })

  // Apply filters
  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  if (filter?.meter_type) {
    query = query.eq('meter_type', filter.meter_type)
  }
  if (filter?.rate_plan) {
    query = query.eq('rate_plan', filter.rate_plan)
  }
  if (filter?.search) {
    query = query.or(`full_name.ilike.%${filter.search}%,email.ilike.%${filter.search}%,account_number.ilike.%${filter.search}%`)
  }

  // Apply pagination
  const page = pagination?.page ?? 1
  const limit = pagination?.limit ?? 20
  const from = (page - 1) * limit
  const to = from + limit - 1

  query = query.range(from, to)

  // Apply sorting
  if (pagination?.sortBy) {
    query = query.order(pagination.sortBy, { ascending: pagination.sortOrder === 'asc' })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const { data, error, count } = await query

  if (error) throw error

  return {
    data: data ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  }
}

export async function getCustomerById(client: Client, id: string): Promise<Customer | null> {
  const { data, error } = await client
    .from('customers')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createCustomer(client: Client, customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>): Promise<Customer> {
  const { data, error } = await client
    .from('customers')
    .insert(customer)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateCustomer(client: Client, id: string, updates: Partial<Customer>): Promise<Customer> {
  const { data, error } = await client
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// Invoice queries
export async function getInvoices(
  client: Client,
  filter?: InvoiceFilter,
  pagination?: PaginationParams
): Promise<PaginatedResponse<Invoice>> {
  let query = client.from('invoices').select('*', { count: 'exact' })

  // Apply filters
  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  if (filter?.customer_id) {
    query = query.eq('customer_id', filter.customer_id)
  }
  if (filter?.date_from) {
    query = query.gte('period_start', filter.date_from)
  }
  if (filter?.date_to) {
    query = query.lte('period_end', filter.date_to)
  }
  if (filter?.min_amount) {
    query = query.gte('total_amount', filter.min_amount)
  }
  if (filter?.max_amount) {
    query = query.lte('total_amount', filter.max_amount)
  }

  // Apply pagination
  const page = pagination?.page ?? 1
  const limit = pagination?.limit ?? 20
  const from = (page - 1) * limit
  const to = from + limit - 1

  query = query.range(from, to)

  // Apply sorting
  if (pagination?.sortBy) {
    query = query.order(pagination.sortBy, { ascending: pagination.sortOrder === 'asc' })
  } else {
    query = query.order('issued_at', { ascending: false })
  }

  const { data, error, count } = await query

  if (error) throw error

  return {
    data: data ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  }
}

export async function getInvoiceById(client: Client, id: string): Promise<Invoice | null> {
  const { data, error } = await client
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function generateInvoiceNumber(client: Client, tenantId: string): Promise<string> {
  const { data, error } = await client
    .rpc('generate_invoice_number', { p_tenant_id: tenantId })

  if (error) throw error
  return data
}

// Meter reading queries
export async function getMeterReadings(
  client: Client,
  filter?: MeterReadingFilter,
  pagination?: PaginationParams
): Promise<PaginatedResponse<MeterReading>> {
  let query = client.from('meter_readings').select('*', { count: 'exact' })

  // Apply filters
  if (filter?.customer_id) {
    query = query.eq('customer_id', filter.customer_id)
  }
  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  if (filter?.meter_id) {
    query = query.eq('meter_id', filter.meter_id)
  }
  if (filter?.date_from) {
    query = query.gte('reading_date', filter.date_from)
  }
  if (filter?.date_to) {
    query = query.lte('reading_date', filter.date_to)
  }

  // Apply pagination
  const page = pagination?.page ?? 1
  const limit = pagination?.limit ?? 20
  const from = (page - 1) * limit
  const to = from + limit - 1

  query = query.range(from, to)

  // Apply sorting
  if (pagination?.sortBy) {
    query = query.order(pagination.sortBy, { ascending: pagination.sortOrder === 'asc' })
  } else {
    query = query.order('reading_date', { ascending: false })
  }

  const { data, error, count } = await query

  if (error) throw error

  return {
    data: data ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  }
}

export async function getMeterReadingById(client: Client, id: string): Promise<MeterReading | null> {
  const { data, error } = await client
    .from('meter_readings')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createMeterReading(
  client: Client, 
  reading: Omit<MeterReading, 'id' | 'created_at' | 'updated_at' | 'consumption'>
): Promise<MeterReading> {
  const { data, error } = await client
    .from('meter_readings')
    .insert(reading)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateMeterReading(
  client: Client, 
  id: string, 
  updates: Partial<MeterReading>
): Promise<MeterReading> {
  const { data, error } = await client
    .from('meter_readings')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// Dashboard statistics
export async function getDashboardStats(client: Client) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  
  // Get customer stats
  const { data: customerStats } = await client
    .from('customers')
    .select('status', { count: 'exact', head: true })
  
  const { count: totalCustomers } = await client
    .from('customers')
    .select('*', { count: 'exact', head: true })
  
  const { count: activeCustomers } = await client
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
  
  // Get invoice stats
  const { count: pendingInvoices } = await client
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent')
  
  const { count: overdueInvoices } = await client
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'overdue')
  
  // Get revenue MTD
  const { data: revenueData } = await client
    .from('invoices')
    .select('total_amount')
    .eq('status', 'paid')
    .gte('paid_at', startOfMonth)
  
  const totalRevenueMtd = revenueData?.reduce((sum, inv) => sum + (inv.total_amount || 0), 0) || 0
  
  // Get consumption MTD
  const { data: consumptionData } = await client
    .from('meter_readings')
    .select('consumption')
    .gte('reading_date', startOfMonth)
    .eq('status', 'confirmed')
  
  const totalConsumptionMtd = consumptionData?.reduce((sum, reading) => sum + (reading.consumption || 0), 0) || 0
  
  // Get reading stats
  const { count: pendingReadings } = await client
    .from('meter_readings')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  
  const { count: flaggedReadings } = await client
    .from('meter_readings')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'flagged')
  
  return {
    total_customers: totalCustomers || 0,
    active_customers: activeCustomers || 0,
    pending_invoices: pendingInvoices || 0,
    overdue_invoices: overdueInvoices || 0,
    total_revenue_mtd: totalRevenueMtd,
    total_consumption_mtd: totalConsumptionMtd,
    pending_readings: pendingReadings || 0,
    flagged_readings: flaggedReadings || 0,
  }
}