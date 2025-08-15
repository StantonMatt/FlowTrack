export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      anomaly_rules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          parameters: Json
          rule_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parameters: Json
          rule_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          parameters?: Json
          rule_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      audit_logs: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string | null
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      customers: {
        Row: {
          account_number: string
          auth_user_id: string | null
          billing_address: Json | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          metadata: Json
          meter_id: string | null
          meter_type: Database["public"]["Enums"]["meter_type"]
          phone: string | null
          rate_plan: string | null
          service_address: Json | null
          status: Database["public"]["Enums"]["customer_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_number: string
          auth_user_id?: string | null
          billing_address?: Json | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          metadata?: Json
          meter_id?: string | null
          meter_type?: Database["public"]["Enums"]["meter_type"]
          phone?: string | null
          rate_plan?: string | null
          service_address?: Json | null
          status?: Database["public"]["Enums"]["customer_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_number?: string
          auth_user_id?: string | null
          billing_address?: Json | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          metadata?: Json
          meter_id?: string | null
          meter_type?: Database["public"]["Enums"]["meter_type"]
          phone?: string | null
          rate_plan?: string | null
          service_address?: Json | null
          status?: Database["public"]["Enums"]["customer_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          errors: Json
          failed_rows: number
          file_name: string | null
          id: string
          processed_rows: number
          started_at: string | null
          status: string
          successful_rows: number
          tenant_id: string
          total_rows: number
          type: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          errors?: Json
          failed_rows?: number
          file_name?: string | null
          id?: string
          processed_rows?: number
          started_at?: string | null
          status?: string
          successful_rows?: number
          tenant_id: string
          total_rows?: number
          type: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          errors?: Json
          failed_rows?: number
          file_name?: string | null
          id?: string
          processed_rows?: number
          started_at?: string | null
          status?: string
          successful_rows?: number
          tenant_id?: string
          total_rows?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      invoice_sequences: {
        Row: {
          created_at: string
          current_value: number
          id: string
          prefix: string | null
          tenant_id: string
          updated_at: string
          year: number | null
        }
        Insert: {
          created_at?: string
          current_value?: number
          id?: string
          prefix?: string | null
          tenant_id: string
          updated_at?: string
          year?: number | null
        }
        Update: {
          created_at?: string
          current_value?: number
          id?: string
          prefix?: string | null
          tenant_id?: string
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      invoices: {
        Row: {
          consumption: number | null
          created_at: string
          customer_id: string
          due_date: string | null
          id: string
          invoice_number: string
          issued_at: string | null
          line_items: Json
          metadata: Json
          paid_at: string | null
          pdf_url: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_amount: number
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          consumption?: number | null
          created_at?: string
          customer_id: string
          due_date?: string | null
          id?: string
          invoice_number: string
          issued_at?: string | null
          line_items?: Json
          metadata?: Json
          paid_at?: string | null
          pdf_url?: string | null
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          consumption?: number | null
          created_at?: string
          customer_id?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          issued_at?: string | null
          line_items?: Json
          metadata?: Json
          paid_at?: string | null
          pdf_url?: string | null
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      meter_readings: {
        Row: {
          anomaly_flags: Json
          consumption: number | null
          created_at: string
          customer_id: string
          id: string
          metadata: Json
          meter_id: string
          notes: string | null
          photo_url: string | null
          previous_reading: number | null
          reading: number
          reading_date: string
          reading_type: string
          recorded_by: string | null
          status: Database["public"]["Enums"]["reading_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          anomaly_flags?: Json
          created_at?: string
          customer_id: string
          id?: string
          metadata?: Json
          meter_id: string
          notes?: string | null
          photo_url?: string | null
          previous_reading?: number | null
          reading: number
          reading_date: string
          reading_type?: string
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["reading_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          anomaly_flags?: Json
          created_at?: string
          customer_id?: string
          id?: string
          metadata?: Json
          meter_id?: string
          notes?: string | null
          photo_url?: string | null
          previous_reading?: number | null
          reading?: number
          reading_date?: string
          reading_type?: string
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["reading_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meter_readings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_readings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_readings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          id: string
          invoice_id: string
          metadata: Json
          payment_method: string | null
          processed_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          id?: string
          invoice_id: string
          metadata?: Json
          payment_method?: string | null
          processed_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          id?: string
          invoice_id?: string
          metadata?: Json
          payment_method?: string | null
          processed_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      rate_plans: {
        Row: {
          base_charge: number
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          metadata: Json
          name: string
          tax_rate: number
          tenant_id: string
          tiers: Json
          updated_at: string
        }
        Insert: {
          base_charge?: number
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          name: string
          tax_rate?: number
          tenant_id: string
          tiers?: Json
          updated_at?: string
        }
        Update: {
          base_charge?: number
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          name?: string
          tax_rate?: number
          tenant_id?: string
          tiers?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
      tenants: {
        Row: {
          billing_settings: Json
          branding: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          settings: Json
          subdomain: string
          updated_at: string
        }
        Insert: {
          billing_settings?: Json
          branding?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
          subdomain: string
          updated_at?: string
        }
        Update: {
          billing_settings?: Json
          branding?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
          subdomain?: string
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          profile: Json
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          profile?: Json
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          profile?: Json
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_consumption: {
        Args: {
          p_customer_id: string
          p_current_reading: number
          p_reading_date: string
        }
        Returns: {
          previous_reading: number
          consumption: number
          days_between: number
        }[]
      }
      generate_invoice_number: {
        Args: {
          p_tenant_id: string
          p_prefix?: string
        }
        Returns: string
      }
      is_staff: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      tenant_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      user_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      user_role: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: {
      customer_status: "active" | "inactive" | "suspended"
      invoice_status: "draft" | "sent" | "paid" | "overdue" | "void" | "cancelled"
      meter_type: "water" | "electric" | "gas" | "other"
      payment_status: "pending" | "processing" | "succeeded" | "failed" | "refunded" | "cancelled"
      reading_status: "pending" | "confirmed" | "flagged" | "rejected"
      user_role: "admin" | "manager" | "operator" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
      PublicSchema["Views"])
  ? (PublicSchema["Tables"] &
      PublicSchema["Views"])[PublicTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
  ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
  ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
  ? PublicSchema["Enums"][PublicEnumNameOrOptions]
  : never