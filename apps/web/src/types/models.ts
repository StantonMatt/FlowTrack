import { Database } from './database.types'

// Type aliases for easier access
export type Tenant = Database['public']['Tables']['tenants']['Row']
export type User = Database['public']['Tables']['users']['Row']
export type Customer = Database['public']['Tables']['customers']['Row']
export type MeterReading = Database['public']['Tables']['meter_readings']['Row']
export type Invoice = Database['public']['Tables']['invoices']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
export type RatePlan = Database['public']['Tables']['rate_plans']['Row']
export type AnomalyRule = Database['public']['Tables']['anomaly_rules']['Row']
export type AuditLog = Database['public']['Tables']['audit_logs']['Row']
export type ImportJob = Database['public']['Tables']['import_jobs']['Row']

// Insert types
export type TenantInsert = Database['public']['Tables']['tenants']['Insert']
export type UserInsert = Database['public']['Tables']['users']['Insert']
export type CustomerInsert = Database['public']['Tables']['customers']['Insert']
export type MeterReadingInsert = Database['public']['Tables']['meter_readings']['Insert']
export type InvoiceInsert = Database['public']['Tables']['invoices']['Insert']
export type PaymentInsert = Database['public']['Tables']['payments']['Insert']

// Update types
export type TenantUpdate = Database['public']['Tables']['tenants']['Update']
export type UserUpdate = Database['public']['Tables']['users']['Update']
export type CustomerUpdate = Database['public']['Tables']['customers']['Update']
export type MeterReadingUpdate = Database['public']['Tables']['meter_readings']['Update']
export type InvoiceUpdate = Database['public']['Tables']['invoices']['Update']

// Enums
export type UserRole = Database['public']['Enums']['user_role']
export type CustomerStatus = Database['public']['Enums']['customer_status']
export type InvoiceStatus = Database['public']['Enums']['invoice_status']
export type PaymentStatus = Database['public']['Enums']['payment_status']
export type MeterType = Database['public']['Enums']['meter_type']
export type ReadingStatus = Database['public']['Enums']['reading_status']

// Extended types with relationships
export interface CustomerWithReadings extends Customer {
  meter_readings: MeterReading[]
}

export interface CustomerWithInvoices extends Customer {
  invoices: Invoice[]
}

export interface InvoiceWithCustomer extends Invoice {
  customer: Customer
}

export interface InvoiceWithPayments extends Invoice {
  payments: Payment[]
}

export interface MeterReadingWithCustomer extends MeterReading {
  customer: Customer
}

export interface PaymentWithInvoice extends Payment {
  invoice: Invoice
}

// Address type
export interface Address {
  street: string
  city: string
  state: string
  zip: string
  country: string
}

// Billing settings type
export interface BillingSettings {
  billing_cycle: 'monthly' | 'bi-monthly' | 'quarterly'
  payment_terms: number
  late_fee_percentage: number
  grace_period_days?: number
  auto_generate_invoices?: boolean
}

// Tenant settings type
export interface TenantSettings {
  timezone: string
  currency: string
  locale: string
  date_format?: string
  number_format?: string
}

// Branding type
export interface TenantBranding {
  primary_color: string
  secondary_color?: string
  logo_url?: string
  favicon_url?: string
  company_address?: string
  company_phone?: string
  company_email?: string
  invoice_footer?: string
}

// Rate tier type
export interface RateTier {
  min: number
  max: number | null
  rate: number
  description?: string
}

// Line item type for invoices
export interface LineItem {
  description: string
  quantity?: number
  unit_price?: number
  amount: number
  tax_rate?: number
  tax_amount?: number
}

// Anomaly rule parameters
export interface AnomalyRuleParameters {
  threshold?: number
  percentage?: number
  comparison?: 'greater_than' | 'less_than' | 'equals' | 'not_equals' | 'increase' | 'decrease'
  window_days?: number
  message?: string
}

// Import job error
export interface ImportError {
  row: number
  field?: string
  error: string
  data?: Record<string, any>
}

// Auth context type
export interface AuthContext {
  user: User | null
  tenant: Tenant | null
  isAuthenticated: boolean
  isLoading: boolean
  permissions: string[]
}

// Pagination types
export interface PaginationParams {
  page: number
  limit: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// Filter types
export interface CustomerFilter {
  status?: CustomerStatus
  search?: string
  meter_type?: MeterType
  rate_plan?: string
}

export interface InvoiceFilter {
  status?: InvoiceStatus
  customer_id?: string
  date_from?: string
  date_to?: string
  min_amount?: number
  max_amount?: number
}

export interface MeterReadingFilter {
  customer_id?: string
  status?: ReadingStatus
  date_from?: string
  date_to?: string
  meter_id?: string
}

// Dashboard statistics
export interface DashboardStats {
  total_customers: number
  active_customers: number
  pending_invoices: number
  overdue_invoices: number
  total_revenue_mtd: number
  total_consumption_mtd: number
  pending_readings: number
  flagged_readings: number
}

// Consumption analytics
export interface ConsumptionAnalytics {
  period: string
  consumption: number
  average_daily: number
  comparison_percent: number
  trend: 'up' | 'down' | 'stable'
}

// Revenue analytics
export interface RevenueAnalytics {
  period: string
  revenue: number
  invoices_count: number
  paid_count: number
  collection_rate: number
}