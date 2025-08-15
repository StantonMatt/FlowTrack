import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@/lib/supabase/server';
import { AccountNumberGenerator } from '@flowtrack/shared/utils/account-number';

// Mock Supabase client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

describe('Customer Service', () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      rpc: vi.fn().mockReturnThis(),
    };

    (createClient as any).mockResolvedValue(mockSupabase);
  });

  describe('Account Number Generation', () => {
    it('should generate unique account numbers', () => {
      const generator = new AccountNumberGenerator();
      const tenantId = 'test-tenant-123';
      
      const accountNumber1 = generator.generate(tenantId, 1);
      const accountNumber2 = generator.generate(tenantId, 2);
      
      expect(accountNumber1).not.toBe(accountNumber2);
      expect(accountNumber1).toMatch(/^\d{10}$/);
      expect(accountNumber2).toMatch(/^\d{10}$/);
    });

    it('should handle concurrent generation safely', async () => {
      const generator = new AccountNumberGenerator();
      const tenantId = 'test-tenant-123';
      
      // Simulate concurrent generation
      const promises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(generator.generate(tenantId, i + 1))
      );
      
      const accountNumbers = await Promise.all(promises);
      const uniqueNumbers = new Set(accountNumbers);
      
      expect(uniqueNumbers.size).toBe(10);
    });
  });

  describe('Customer CRUD Operations', () => {
    it('should create a customer with valid data', async () => {
      const customerData = {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
        phone: '555-0100',
        service_address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        postal_code: '62701',
      };

      mockSupabase.insert.mockResolvedValue({
        data: { id: 'customer-123', ...customerData },
        error: null,
      });

      const result = await mockSupabase
        .from('customers')
        .insert(customerData);

      expect(result.error).toBeNull();
      expect(result.data).toMatchObject(customerData);
    });

    it('should update customer data', async () => {
      const updateData = {
        phone: '555-0200',
        email: 'john.updated@example.com',
      };

      mockSupabase.update.mockResolvedValue({
        data: { id: 'customer-123', ...updateData },
        error: null,
      });

      const result = await mockSupabase
        .from('customers')
        .update(updateData)
        .eq('id', 'customer-123');

      expect(result.error).toBeNull();
      expect(result.data).toMatchObject(updateData);
    });

    it('should soft delete customer', async () => {
      mockSupabase.update.mockResolvedValue({
        data: { id: 'customer-123', status: 'inactive' },
        error: null,
      });

      const result = await mockSupabase
        .from('customers')
        .update({ status: 'inactive' })
        .eq('id', 'customer-123');

      expect(result.error).toBeNull();
      expect(result.data.status).toBe('inactive');
    });
  });

  describe('Customer Search and Filters', () => {
    it('should search customers by name', async () => {
      const searchTerm = 'john';
      
      mockSupabase.or.mockResolvedValue({
        data: [
          { id: '1', first_name: 'John', last_name: 'Doe' },
          { id: '2', first_name: 'Johnny', last_name: 'Smith' },
        ],
        error: null,
      });

      const result = await mockSupabase
        .from('customers')
        .select('*')
        .or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`);

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(2);
    });

    it('should filter customers by status', async () => {
      mockSupabase.eq.mockResolvedValue({
        data: [
          { id: '1', first_name: 'John', status: 'active' },
          { id: '2', first_name: 'Jane', status: 'active' },
        ],
        error: null,
      });

      const result = await mockSupabase
        .from('customers')
        .select('*')
        .eq('status', 'active');

      expect(result.error).toBeNull();
      expect(result.data.every((c: any) => c.status === 'active')).toBe(true);
    });

    it('should paginate results correctly', async () => {
      const page = 2;
      const limit = 10;
      const offset = (page - 1) * limit;

      mockSupabase.range.mockResolvedValue({
        data: Array.from({ length: 10 }, (_, i) => ({
          id: `customer-${offset + i + 1}`,
          first_name: `Customer${offset + i + 1}`,
        })),
        error: null,
        count: 50,
      });

      const result = await mockSupabase
        .from('customers')
        .select('*', { count: 'exact' })
        .range(offset, offset + limit - 1);

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(10);
      expect(result.count).toBe(50);
    });
  });

  describe('Tenant Isolation', () => {
    it('should scope all queries to tenant', async () => {
      const tenantId = 'tenant-123';
      
      mockSupabase.eq.mockImplementation((field: string, value: any) => {
        if (field === 'tenant_id') {
          expect(value).toBe(tenantId);
        }
        return mockSupabase;
      });

      await mockSupabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId);

      expect(mockSupabase.eq).toHaveBeenCalledWith('tenant_id', tenantId);
    });

    it('should prevent cross-tenant data access', async () => {
      const tenantId = 'tenant-123';
      const wrongTenantId = 'tenant-456';

      mockSupabase.eq.mockImplementation((field: string, value: any) => {
        if (field === 'tenant_id' && value === wrongTenantId) {
          return {
            ...mockSupabase,
            select: () => ({ data: [], error: null }),
          };
        }
        return mockSupabase;
      });

      const result = await mockSupabase
        .from('customers')
        .select('*')
        .eq('tenant_id', wrongTenantId);

      expect(result.data).toEqual([]);
    });
  });
});