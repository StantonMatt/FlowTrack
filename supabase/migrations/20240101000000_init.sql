-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create enums
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'operator', 'viewer');
CREATE TYPE customer_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled');
CREATE TYPE meter_type AS ENUM ('water', 'electric', 'gas', 'other');
CREATE TYPE reading_status AS ENUM ('pending', 'confirmed', 'flagged', 'rejected');

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TENANTS TABLE
-- ============================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(63) UNIQUE NOT NULL CHECK (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
    settings JSONB DEFAULT '{}',
    billing_settings JSONB DEFAULT '{}',
    branding JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- USERS TABLE (Staff Users)
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role user_role NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT true,
    profile JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CUSTOMERS TABLE
-- ============================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    auth_user_id UUID, -- For customer portal access
    account_number VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    status customer_status DEFAULT 'active',
    billing_address JSONB,
    service_address JSONB,
    meter_id VARCHAR(100),
    meter_type meter_type DEFAULT 'water',
    rate_plan VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, account_number)
);

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- METER_READINGS TABLE
-- ============================================
CREATE TABLE meter_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    meter_id VARCHAR(100) NOT NULL,
    reading NUMERIC(12,3) NOT NULL CHECK (reading >= 0),
    previous_reading NUMERIC(12,3),
    consumption NUMERIC(12,3) GENERATED ALWAYS AS (
        CASE 
            WHEN previous_reading IS NOT NULL THEN reading - previous_reading
            ELSE NULL
        END
    ) STORED,
    reading_date TIMESTAMPTZ NOT NULL,
    reading_type VARCHAR(50) DEFAULT 'manual', -- manual, automatic, estimated
    status reading_status DEFAULT 'pending',
    anomaly_flags JSONB DEFAULT '[]',
    photo_url TEXT,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    recorded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_meter_readings_updated_at BEFORE UPDATE ON meter_readings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INVOICES TABLE
-- ============================================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(50) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    consumption NUMERIC(12,3),
    line_items JSONB DEFAULT '[]',
    subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(10,2) DEFAULT 0,
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    status invoice_status DEFAULT 'draft',
    issued_at TIMESTAMPTZ,
    due_date DATE,
    paid_at TIMESTAMPTZ,
    pdf_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, invoice_number),
    CHECK (period_start <= period_end)
);

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- PAYMENTS TABLE
-- ============================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    status payment_status DEFAULT 'pending',
    payment_method VARCHAR(50),
    stripe_payment_intent_id VARCHAR(255),
    stripe_charge_id VARCHAR(255),
    processed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INVOICE_SEQUENCES TABLE (for sequential numbering)
-- ============================================
CREATE TABLE invoice_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    prefix VARCHAR(10),
    current_value INTEGER NOT NULL DEFAULT 0,
    year INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, prefix, year)
);

CREATE TRIGGER update_invoice_sequences_updated_at BEFORE UPDATE ON invoice_sequences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RATE_PLANS TABLE
-- ============================================
CREATE TABLE rate_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    tiers JSONB DEFAULT '[]', -- Array of tier definitions
    base_charge NUMERIC(10,2) DEFAULT 0,
    tax_rate NUMERIC(5,4) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

CREATE TRIGGER update_rate_plans_updated_at BEFORE UPDATE ON rate_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ANOMALY_RULES TABLE
-- ============================================
CREATE TABLE anomaly_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50) NOT NULL, -- threshold, percentage_change, etc.
    parameters JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_anomaly_rules_updated_at BEFORE UPDATE ON anomaly_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- AUDIT_LOGS TABLE
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    changes JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- IMPORT_JOBS TABLE
-- ============================================
CREATE TABLE import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- customers, readings, etc.
    status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
    file_name VARCHAR(255),
    total_rows INTEGER DEFAULT 0,
    processed_rows INTEGER DEFAULT 0,
    successful_rows INTEGER DEFAULT 0,
    failed_rows INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_import_jobs_updated_at BEFORE UPDATE ON import_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Tenant-based indexes
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX idx_customers_tenant_status ON customers(tenant_id, status);
CREATE INDEX idx_customers_tenant_account ON customers(tenant_id, account_number);

-- Meter readings indexes
CREATE INDEX idx_meter_readings_tenant_id ON meter_readings(tenant_id);
CREATE INDEX idx_meter_readings_customer_date ON meter_readings(customer_id, reading_date DESC);
CREATE INDEX idx_meter_readings_tenant_customer_date ON meter_readings(tenant_id, customer_id, reading_date DESC);
CREATE INDEX idx_meter_readings_status ON meter_readings(tenant_id, status);

-- Invoices indexes
CREATE INDEX idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX idx_invoices_tenant_status ON invoices(tenant_id, status);
CREATE INDEX idx_invoices_tenant_period ON invoices(tenant_id, period_end DESC);
CREATE INDEX idx_invoices_tenant_customer_issued ON invoices(tenant_id, customer_id, issued_at DESC);

-- Payments indexes
CREATE INDEX idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_customer_id ON payments(customer_id);
CREATE INDEX idx_payments_status ON payments(tenant_id, status);

-- Audit logs indexes
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Import jobs indexes
CREATE INDEX idx_import_jobs_tenant_id ON import_jobs(tenant_id);
CREATE INDEX idx_import_jobs_status ON import_jobs(tenant_id, status);

-- JSONB indexes
CREATE INDEX idx_customers_metadata ON customers USING GIN (metadata);
CREATE INDEX idx_tenants_settings ON tenants USING GIN (settings);
CREATE INDEX idx_invoices_line_items ON invoices USING GIN (line_items);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to get current tenant_id from JWT
CREATE OR REPLACE FUNCTION get_auth_tenant_id()
RETURNS UUID AS $$
BEGIN
    RETURN COALESCE(
        current_setting('request.jwt.claims', true)::json->>'tenant_id',
        current_setting('request.jwt.claim.tenant_id', true)
    )::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get current user role from JWT
CREATE OR REPLACE FUNCTION get_auth_user_role()
RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        current_setting('request.jwt.claims', true)::json->>'role',
        current_setting('request.jwt.claim.role', true),
        'viewer'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN 'viewer';
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to check if current user is staff
CREATE OR REPLACE FUNCTION is_auth_staff()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_auth_user_role() IN ('admin', 'manager', 'operator', 'viewer');
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get current user id
CREATE OR REPLACE FUNCTION get_auth_user_id()
RETURNS UUID AS $$
BEGIN
    RETURN COALESCE(
        current_setting('request.jwt.claims', true)::json->>'sub',
        (current_setting('request.jwt.claims', true)::json->>'user_id')
    )::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

-- TENANTS policies (only accessible by members)
CREATE POLICY tenant_isolation ON tenants
    FOR ALL
    USING (id = get_auth_tenant_id());

-- USERS policies
CREATE POLICY users_tenant_isolation ON users
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- CUSTOMERS policies
CREATE POLICY customers_tenant_isolation ON customers
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- Special policy for customer self-service (view their own record)
CREATE POLICY customers_self_service ON customers
    FOR SELECT
    USING (
        auth_user_id = get_auth_user_id()
        OR tenant_id = get_auth_tenant_id()
    );

-- METER_READINGS policies
CREATE POLICY meter_readings_tenant_isolation ON meter_readings
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- INVOICES policies
CREATE POLICY invoices_tenant_isolation ON invoices
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- Special policy for customer self-service (view their own invoices)
CREATE POLICY invoices_customer_self_service ON invoices
    FOR SELECT
    USING (
        customer_id IN (
            SELECT id FROM customers 
            WHERE auth_user_id = get_auth_user_id()
        )
        OR tenant_id = get_auth_tenant_id()
    );

-- PAYMENTS policies
CREATE POLICY payments_tenant_isolation ON payments
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- INVOICE_SEQUENCES policies
CREATE POLICY invoice_sequences_tenant_isolation ON invoice_sequences
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- RATE_PLANS policies
CREATE POLICY rate_plans_tenant_isolation ON rate_plans
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- ANOMALY_RULES policies
CREATE POLICY anomaly_rules_tenant_isolation ON anomaly_rules
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- AUDIT_LOGS policies
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- IMPORT_JOBS policies
CREATE POLICY import_jobs_tenant_isolation ON import_jobs
    FOR ALL
    USING (tenant_id = get_auth_tenant_id())
    WITH CHECK (tenant_id = get_auth_tenant_id());

-- ============================================
-- HELPER FUNCTIONS FOR BUSINESS LOGIC
-- ============================================

-- Function to generate next invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number(
    p_tenant_id UUID,
    p_prefix VARCHAR DEFAULT 'INV'
)
RETURNS VARCHAR AS $$
DECLARE
    v_year INTEGER;
    v_current_value INTEGER;
    v_invoice_number VARCHAR;
BEGIN
    v_year := EXTRACT(YEAR FROM NOW());
    
    -- Get and increment the sequence
    UPDATE invoice_sequences
    SET current_value = current_value + 1,
        updated_at = NOW()
    WHERE tenant_id = p_tenant_id
        AND prefix = p_prefix
        AND year = v_year
    RETURNING current_value INTO v_current_value;
    
    -- If no sequence exists, create one
    IF v_current_value IS NULL THEN
        INSERT INTO invoice_sequences (tenant_id, prefix, year, current_value)
        VALUES (p_tenant_id, p_prefix, v_year, 1)
        ON CONFLICT (tenant_id, prefix, year)
        DO UPDATE SET current_value = invoice_sequences.current_value + 1
        RETURNING current_value INTO v_current_value;
    END IF;
    
    -- Format the invoice number
    v_invoice_number := p_prefix || '-' || v_year || '-' || LPAD(v_current_value::TEXT, 6, '0');
    
    RETURN v_invoice_number;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate consumption between readings
CREATE OR REPLACE FUNCTION calculate_consumption(
    p_customer_id UUID,
    p_current_reading NUMERIC,
    p_reading_date TIMESTAMPTZ
)
RETURNS TABLE (
    previous_reading NUMERIC,
    consumption NUMERIC,
    days_between INTEGER
) AS $$
DECLARE
    v_previous RECORD;
BEGIN
    -- Get the most recent confirmed reading before this date
    SELECT 
        mr.reading,
        mr.reading_date
    INTO v_previous
    FROM meter_readings mr
    WHERE mr.customer_id = p_customer_id
        AND mr.reading_date < p_reading_date
        AND mr.status = 'confirmed'
    ORDER BY mr.reading_date DESC
    LIMIT 1;
    
    IF v_previous IS NULL THEN
        RETURN QUERY SELECT 
            NULL::NUMERIC,
            NULL::NUMERIC,
            NULL::INTEGER;
    ELSE
        RETURN QUERY SELECT 
            v_previous.reading,
            p_current_reading - v_previous.reading,
            EXTRACT(DAY FROM p_reading_date - v_previous.reading_date)::INTEGER;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- Grant all privileges to service role
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Grant appropriate permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Grant limited permissions to anonymous users (for public APIs if needed)
GRANT SELECT ON tenants TO anon;
GRANT SELECT ON invoices TO anon; -- With RLS, they'll only see what they're allowed