export interface Customer {
  id: string;
  tenant_id: string;
  full_name: string;
  email?: string;
  phone?: string;
  account_number: string;
  meter_number?: string;
  service_address: string;
  billing_address?: string;
  customer_type: 'residential' | 'commercial' | 'industrial' | 'institutional';
  status: 'active' | 'inactive' | 'suspended';
  connection_date?: string;
  disconnection_date?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerInput {
  full_name: string;
  email?: string;
  phone?: string;
  account_number?: string; // Auto-generated if not provided
  meter_number?: string;
  service_address: string;
  billing_address?: string;
  customer_type?: 'residential' | 'commercial' | 'industrial' | 'institutional';
  status?: 'active' | 'inactive' | 'suspended';
  connection_date?: string;
  metadata?: Record<string, any>;
}

export interface UpdateCustomerInput {
  full_name?: string;
  email?: string;
  phone?: string;
  meter_number?: string;
  service_address?: string;
  billing_address?: string;
  customer_type?: 'residential' | 'commercial' | 'industrial' | 'institutional';
  status?: 'active' | 'inactive' | 'suspended';
  disconnection_date?: string;
  metadata?: Record<string, any>;
}