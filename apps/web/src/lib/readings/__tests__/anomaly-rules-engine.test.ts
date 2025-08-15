import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnomalyRulesEngine } from '../anomaly-rules-engine';

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

describe('AnomalyRulesEngine', () => {
  let engine: AnomalyRulesEngine;
  let mockSupabase: any;

  beforeEach(() => {
    engine = new AnomalyRulesEngine();
    mockSupabase = (engine as any).supabase;
    // Clear cache before each test
    engine.clearCache();
  });

  describe('checkReading', () => {
    it('should pass when no rules are triggered', async () => {
      // Mock empty rules
      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      const result = await engine.checkReading(
        'tenant-123',
        'customer-456',
        1000,
        '2024-01-15',
        950,
        '2024-01-01',
        50
      );

      expect(result.passed).toBe(true);
      expect(result.triggered_rules).toHaveLength(0);
      expect(result.anomaly_score).toBe(0);
    });

    it('should trigger consumption threshold rule', async () => {
      const rules = [
        {
          id: 'rule-1',
          tenant_id: 'tenant-123',
          name: 'High Consumption',
          rule_type: 'consumption_threshold',
          parameters: {
            max_threshold: 100,
            severity: 'high',
          },
          is_active: true,
        },
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: rules,
              error: null,
            }),
          }),
        }),
      });

      const result = await engine.checkReading(
        'tenant-123',
        'customer-456',
        1200,
        '2024-01-15',
        1000,
        '2024-01-01',
        200 // Exceeds threshold of 100
      );

      expect(result.passed).toBe(false);
      expect(result.triggered_rules).toHaveLength(1);
      expect(result.triggered_rules[0].rule_type).toBe('consumption_threshold');
      expect(result.triggered_rules[0].severity).toBe('high');
      expect(result.anomaly_score).toBe(50); // High severity = 50 points
    });

    it('should trigger multiple rules', async () => {
      const rules = [
        {
          id: 'rule-1',
          tenant_id: 'tenant-123',
          name: 'Negative Consumption',
          rule_type: 'negative_consumption',
          parameters: {
            threshold: 0,
            severity: 'critical',
          },
          is_active: true,
        },
        {
          id: 'rule-2',
          tenant_id: 'tenant-123',
          name: 'Meter Rollback',
          rule_type: 'meter_rollback',
          parameters: {
            max_rollback: 10,
            severity: 'critical',
          },
          is_active: true,
        },
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: rules,
              error: null,
            }),
          }),
        }),
      });

      const result = await engine.checkReading(
        'tenant-123',
        'customer-456',
        900,
        '2024-01-15',
        1000,
        '2024-01-01',
        -100 // Negative consumption
      );

      expect(result.passed).toBe(false);
      expect(result.triggered_rules).toHaveLength(2);
      expect(result.anomaly_score).toBe(100); // Capped at 100
    });

    it('should cache rules for performance', async () => {
      const rules = [
        {
          id: 'rule-1',
          tenant_id: 'tenant-123',
          name: 'Test Rule',
          rule_type: 'consumption_threshold',
          parameters: { max_threshold: 100 },
          is_active: true,
        },
      ];

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: rules,
              error: null,
            }),
          }),
        }),
      });

      mockSupabase.from = fromMock;

      // First call - should fetch from database
      await engine.checkReading('tenant-123', 'customer-456', 1000, '2024-01-15');
      expect(fromMock).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await engine.checkReading('tenant-123', 'customer-456', 1100, '2024-01-16');
      expect(fromMock).toHaveBeenCalledTimes(1); // Still 1, used cache
    });
  });

  describe('Rule Evaluations', () => {
    describe('consumption_threshold', () => {
      it('should trigger when consumption exceeds maximum', async () => {
        const rules = [
          {
            id: 'rule-1',
            tenant_id: 'tenant-123',
            name: 'Max Consumption',
            rule_type: 'consumption_threshold',
            parameters: {
              max_threshold: 500,
              severity: 'medium',
            },
            is_active: true,
          },
        ];

        mockSupabase.from = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: rules,
                error: null,
              }),
            }),
          }),
        });

        const result = await engine.checkReading(
          'tenant-123',
          'customer-456',
          1600,
          '2024-01-15',
          1000,
          '2024-01-01',
          600 // Exceeds 500
        );

        expect(result.passed).toBe(false);
        expect(result.triggered_rules[0].message).toContain('exceeds maximum threshold');
      });

      it('should trigger when consumption below minimum', async () => {
        const rules = [
          {
            id: 'rule-1',
            tenant_id: 'tenant-123',
            name: 'Min Consumption',
            rule_type: 'consumption_threshold',
            parameters: {
              min_threshold: 10,
              severity: 'low',
            },
            is_active: true,
          },
        ];

        mockSupabase.from = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: rules,
                error: null,
              }),
            }),
          }),
        });

        const result = await engine.checkReading(
          'tenant-123',
          'customer-456',
          1005,
          '2024-01-15',
          1000,
          '2024-01-01',
          5 // Below 10
        );

        expect(result.passed).toBe(false);
        expect(result.triggered_rules[0].message).toContain('below minimum threshold');
      });
    });

    describe('percentage_change', () => {
      it('should detect large percentage increase', async () => {
        const rules = [
          {
            id: 'rule-1',
            tenant_id: 'tenant-123',
            name: 'Percentage Increase',
            rule_type: 'percentage_change',
            parameters: {
              max_increase_pct: 50,
              severity: 'medium',
            },
            is_active: true,
          },
        ];

        mockSupabase.from = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: rules,
                error: null,
              }),
            }),
          }),
        });

        const result = await engine.checkReading(
          'tenant-123',
          'customer-456',
          2000, // 100% increase from 1000
          '2024-01-15',
          1000,
          '2024-01-01',
          1000
        );

        expect(result.passed).toBe(false);
        expect(result.triggered_rules[0].message).toContain('increased by 100.0%');
      });

      it('should detect large percentage decrease', async () => {
        const rules = [
          {
            id: 'rule-1',
            tenant_id: 'tenant-123',
            name: 'Percentage Decrease',
            rule_type: 'percentage_change',
            parameters: {
              max_decrease_pct: 30,
              severity: 'high',
            },
            is_active: true,
          },
        ];

        mockSupabase.from = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: rules,
                error: null,
              }),
            }),
          }),
        });

        const result = await engine.checkReading(
          'tenant-123',
          'customer-456',
          500, // 50% decrease from 1000
          '2024-01-15',
          1000,
          '2024-01-01',
          -500
        );

        expect(result.passed).toBe(false);
        expect(result.triggered_rules[0].message).toContain('decreased by 50.0%');
      });
    });

    describe('zero_consumption', () => {
      it('should detect extended zero consumption', async () => {
        const rules = [
          {
            id: 'rule-1',
            tenant_id: 'tenant-123',
            name: 'Zero Consumption',
            rule_type: 'zero_consumption',
            parameters: {
              min_days: 30,
              severity: 'low',
            },
            is_active: true,
          },
        ];

        mockSupabase.from = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: rules,
                error: null,
              }),
            }),
          }),
        });

        const result = await engine.checkReading(
          'tenant-123',
          'customer-456',
          1000,
          '2024-03-01', // 60 days later
          1000,
          '2024-01-01',
          0 // Zero consumption
        );

        expect(result.passed).toBe(false);
        expect(result.triggered_rules[0].message).toContain('Zero consumption for');
      });
    });

    describe('meter_rollback', () => {
      it('should detect meter rollback', async () => {
        const rules = [
          {
            id: 'rule-1',
            tenant_id: 'tenant-123',
            name: 'Meter Rollback',
            rule_type: 'meter_rollback',
            parameters: {
              max_rollback: 10,
              severity: 'critical',
            },
            is_active: true,
          },
        ];

        mockSupabase.from = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: rules,
                error: null,
              }),
            }),
          }),
        });

        const result = await engine.checkReading(
          'tenant-123',
          'customer-456',
          900, // Rolled back from 1000
          '2024-01-15',
          1000,
          '2024-01-01',
          -100
        );

        expect(result.passed).toBe(false);
        expect(result.triggered_rules[0].severity).toBe('critical');
        expect(result.triggered_rules[0].message).toContain('Meter rollback detected');
      });
    });

    describe('statistical_outlier', () => {
      it('should detect statistical outliers', async () => {
        const rules = [
          {
            id: 'rule-1',
            tenant_id: 'tenant-123',
            name: 'Outlier Detection',
            rule_type: 'statistical_outlier',
            parameters: {
              std_deviations: 2,
              severity: 'medium',
            },
            is_active: true,
          },
        ];

        // Mock historical data with consistent consumption
        const historicalData = Array(20).fill(null).map((_, i) => ({
          reading_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          consumption: 100 + (Math.random() * 20 - 10), // 90-110 range
        }));

        mockSupabase.from = vi.fn()
          .mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: rules,
                  error: null,
                }),
              }),
            }),
          })
          .mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    lt: vi.fn().mockReturnValue({
                      order: vi.fn().mockResolvedValue({
                        data: historicalData,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          });

        const result = await engine.checkReading(
          'tenant-123',
          'customer-456',
          1500,
          '2024-02-01',
          1000,
          '2024-01-20',
          500 // Way outside normal range
        );

        expect(result.passed).toBe(false);
        expect(result.triggered_rules[0].message).toContain('standard deviations from mean');
      });
    });

    describe('leak_detection', () => {
      it('should detect potential leaks', async () => {
        const rules = [
          {
            id: 'rule-1',
            tenant_id: 'tenant-123',
            name: 'Leak Detection',
            rule_type: 'leak_detection',
            parameters: {
              min_daily_usage: 100,
              consecutive_days: 7,
              severity: 'high',
            },
            is_active: true,
          },
        ];

        // Mock consistent high usage data
        const recentData = Array(10).fill(null).map((_, i) => ({
          reading_date: `2024-01-${String(20 - i).padStart(2, '0')}`,
          consumption: 800, // 800 units per reading
        }));

        mockSupabase.from = vi.fn()
          .mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: rules,
                  error: null,
                }),
              }),
            }),
          })
          .mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    lt: vi.fn().mockReturnValue({
                      order: vi.fn().mockResolvedValue({
                        data: recentData,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          });

        const result = await engine.checkReading(
          'tenant-123',
          'customer-456',
          10800,
          '2024-01-21',
          10000,
          '2024-01-20',
          800
        );

        expect(result.passed).toBe(false);
        expect(result.triggered_rules[0].message).toContain('Potential leak detected');
      });
    });
  });

  describe('createDefaultRules', () => {
    it('should create default rules for a tenant', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabase.from = vi.fn().mockReturnValue({
        insert: insertMock,
      });

      await engine.createDefaultRules('tenant-123');

      expect(insertMock).toHaveBeenCalled();
      const insertedRules = insertMock.mock.calls[0][0];
      expect(insertedRules).toHaveLength(7);
      expect(insertedRules[0].tenant_id).toBe('tenant-123');
      expect(insertedRules[0].rule_type).toBe('consumption_threshold');
    });

    it('should throw error if creation fails', async () => {
      mockSupabase.from = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({
          error: { message: 'Database error' },
        }),
      });

      await expect(engine.createDefaultRules('tenant-123'))
        .rejects.toThrow('Failed to create default anomaly rules');
    });
  });

  describe('clearCache', () => {
    it('should clear cache for specific tenant', async () => {
      const rules = [
        {
          id: 'rule-1',
          tenant_id: 'tenant-123',
          name: 'Test',
          rule_type: 'consumption_threshold',
          parameters: {},
          is_active: true,
        },
      ];

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: rules,
              error: null,
            }),
          }),
        }),
      });

      mockSupabase.from = fromMock;

      // Load rules into cache
      await engine.checkReading('tenant-123', 'customer-456', 1000, '2024-01-15');
      expect(fromMock).toHaveBeenCalledTimes(1);

      // Clear cache for tenant
      engine.clearCache('tenant-123');

      // Next call should fetch from database again
      await engine.checkReading('tenant-123', 'customer-456', 1100, '2024-01-16');
      expect(fromMock).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache when no tenant specified', () => {
      engine.clearCache();
      // Cache should be empty
      expect((engine as any).rulesCache.size).toBe(0);
      expect((engine as any).lastCacheTime.size).toBe(0);
    });
  });
});