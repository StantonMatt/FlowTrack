import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsumptionCalculator } from '../consumption-calculator';

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            lt: vi.fn(() => ({
              order: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn(),
                  })),
                })),
              })),
            })),
          })),
        })),
        gte: vi.fn(() => ({
          lte: vi.fn(() => ({
            order: vi.fn(() => ({
              data: [],
              error: null,
            })),
          })),
        })),
        order: vi.fn(() => ({
          data: [],
          error: null,
        })),
      })),
    })),
  })),
}));

describe('ConsumptionCalculator', () => {
  let calculator: ConsumptionCalculator;
  let mockSupabase: any;

  beforeEach(() => {
    calculator = new ConsumptionCalculator();
    // Get mock supabase instance
    mockSupabase = (calculator as any).supabase;
  });

  describe('calculateConsumption', () => {
    it('should calculate consumption correctly', async () => {
      const previousReading = {
        id: 'prev-123',
        reading_value: 1000,
        reading_date: '2024-01-01',
      };

      // Mock the query chain
      const singleMock = vi.fn().mockResolvedValue({
        data: previousReading,
        error: null,
      });

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: singleMock,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await calculator.calculateConsumption(
        'tenant-123',
        'customer-456',
        1250,
        '2024-02-01'
      );

      expect(result).toEqual({
        previous_value: 1000,
        previous_date: '2024-01-01',
        consumption: 250,
        anomaly_flags: [],
      });
    });

    it('should handle first reading (no previous)', async () => {
      // Mock no previous reading
      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: null,
                        error: { code: 'PGRST116', message: 'No rows found' },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await calculator.calculateConsumption(
        'tenant-123',
        'customer-456',
        1000,
        '2024-01-01'
      );

      expect(result).toEqual({
        previous_value: null,
        previous_date: null,
        consumption: null,
        anomaly_flags: [],
      });
    });

    it('should detect negative consumption', async () => {
      const previousReading = {
        id: 'prev-123',
        reading_value: 1500,
        reading_date: '2024-01-01',
      };

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: previousReading,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await calculator.calculateConsumption(
        'tenant-123',
        'customer-456',
        1200, // Lower than previous
        '2024-02-01'
      );

      expect(result.consumption).toBe(-300);
      expect(result.anomaly_flags).toContain('negative_consumption');
      expect(result.anomaly_flags).toContain('possible_tampering');
    });

    it('should detect high consumption', async () => {
      const previousReading = {
        id: 'prev-123',
        reading_value: 1000,
        reading_date: '2024-01-01',
      };

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: previousReading,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await calculator.calculateConsumption(
        'tenant-123',
        'customer-456',
        12000, // Very high increase
        '2024-01-05' // Only 4 days later
      );

      expect(result.consumption).toBe(11000);
      expect(result.anomaly_flags).toContain('high_consumption');
      expect(result.anomaly_flags).toContain('large_percentage_increase');
    });

    it('should detect potential leak', async () => {
      const previousReading = {
        id: 'prev-123',
        reading_value: 1000,
        reading_date: '2024-01-01',
      };

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: previousReading,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await calculator.calculateConsumption(
        'tenant-123',
        'customer-456',
        5000, // 4000 units over 7 days = ~571 per day
        '2024-01-08'
      );

      expect(result.consumption).toBe(4000);
      expect(result.anomaly_flags).toContain('potential_leak');
      expect(result.anomaly_flags).toContain('large_percentage_increase');
    });

    it('should detect zero consumption over extended period', async () => {
      const previousReading = {
        id: 'prev-123',
        reading_value: 1000,
        reading_date: '2024-01-01',
      };

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: previousReading,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await calculator.calculateConsumption(
        'tenant-123',
        'customer-456',
        1000, // Same reading after 35 days
        '2024-02-05'
      );

      expect(result.consumption).toBe(0);
      expect(result.anomaly_flags).toContain('zero_consumption_extended');
    });

    it('should handle decimal precision correctly', async () => {
      const previousReading = {
        id: 'prev-123',
        reading_value: 1234.567,
        reading_date: '2024-01-01',
      };

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: previousReading,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await calculator.calculateConsumption(
        'tenant-123',
        'customer-456',
        1234.891,
        '2024-02-01'
      );

      expect(result.consumption).toBe(0.324); // Rounded to 3 decimal places
    });

    it('should handle query errors gracefully', async () => {
      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: null,
                        error: { code: 'OTHER', message: 'Database error' },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await calculator.calculateConsumption(
        'tenant-123',
        'customer-456',
        1000,
        '2024-01-01'
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Database error');
      expect(result.consumption).toBeNull();
    });
  });

  describe('batchCalculateConsumption', () => {
    it('should process multiple readings for same customer in order', async () => {
      const readings = [
        {
          tenant_id: 'tenant-123',
          customer_id: 'customer-456',
          reading_value: 1200,
          reading_date: '2024-02-01',
        },
        {
          tenant_id: 'tenant-123',
          customer_id: 'customer-456',
          reading_value: 1000,
          reading_date: '2024-01-01', // Earlier date, should be processed first
        },
      ];

      // Mock first reading (no previous)
      mockSupabase.from = vi.fn()
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        single: vi.fn().mockResolvedValue({
                          data: null,
                          error: { code: 'PGRST116' },
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        })
        // Mock second reading (has previous)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        single: vi.fn().mockResolvedValue({
                          data: {
                            id: 'prev-123',
                            reading_value: 1000,
                            reading_date: '2024-01-01',
                          },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        });

      const results = await calculator.batchCalculateConsumption(readings);

      expect(results.size).toBe(2);
      
      const firstResult = results.get('tenant-123-customer-456-2024-01-01');
      expect(firstResult?.previous_value).toBeNull();
      expect(firstResult?.consumption).toBeNull();

      const secondResult = results.get('tenant-123-customer-456-2024-02-01');
      expect(secondResult?.previous_value).toBe(1000);
      expect(secondResult?.consumption).toBe(200);
    });

    it('should handle multiple customers separately', async () => {
      const readings = [
        {
          tenant_id: 'tenant-123',
          customer_id: 'customer-456',
          reading_value: 1000,
          reading_date: '2024-01-01',
        },
        {
          tenant_id: 'tenant-123',
          customer_id: 'customer-789',
          reading_value: 2000,
          reading_date: '2024-01-01',
        },
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: null,
                        error: { code: 'PGRST116' },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const results = await calculator.batchCalculateConsumption(readings);

      expect(results.size).toBe(2);
      expect(results.has('tenant-123-customer-456-2024-01-01')).toBe(true);
      expect(results.has('tenant-123-customer-789-2024-01-01')).toBe(true);
    });
  });

  describe('getConsumptionStatistics', () => {
    it('should calculate statistics correctly', async () => {
      const mockReadings = [
        {
          reading_value: 1300,
          reading_date: '2024-03-01',
          consumption: 100,
          anomaly_flag: false,
        },
        {
          reading_value: 1200,
          reading_date: '2024-02-01',
          consumption: 150,
          anomaly_flag: false,
        },
        {
          reading_value: 1050,
          reading_date: '2024-01-01',
          consumption: 50,
          anomaly_flag: true,
        },
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: mockReadings,
                error: null,
              }),
            }),
          }),
        }),
      });

      const stats = await calculator.getConsumptionStatistics(
        'tenant-123',
        'customer-456'
      );

      expect(stats.total_consumption).toBe(300);
      expect(stats.reading_count).toBe(3);
      expect(stats.anomaly_count).toBe(1);
      expect(stats.min_consumption).toBe(50);
      expect(stats.max_consumption).toBe(150);
      expect(stats.average_daily).toBeCloseTo(5, 0); // 300 units over ~60 days
    });

    it('should handle date filters', async () => {
      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const stats = await calculator.getConsumptionStatistics(
        'tenant-123',
        'customer-456',
        '2024-01-01',
        '2024-03-31'
      );

      expect(stats.total_consumption).toBe(0);
      expect(stats.reading_count).toBe(0);
    });

    it('should handle empty results', async () => {
      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          }),
        }),
      });

      const stats = await calculator.getConsumptionStatistics(
        'tenant-123',
        'customer-456'
      );

      expect(stats).toEqual({
        average_daily: 0,
        total_consumption: 0,
        reading_count: 0,
        anomaly_count: 0,
        min_consumption: 0,
        max_consumption: 0,
      });
    });
  });
});