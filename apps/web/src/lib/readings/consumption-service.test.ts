import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsumptionService } from './consumption-service';
import { createClient } from '@/lib/supabase/client';

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

describe('ConsumptionService', () => {
  let service: ConsumptionService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(() => mockSupabase),
      select: vi.fn(() => mockSupabase),
      eq: vi.fn(() => mockSupabase),
      neq: vi.fn(() => mockSupabase),
      lt: vi.fn(() => mockSupabase),
      not: vi.fn(() => mockSupabase),
      order: vi.fn(() => mockSupabase),
      limit: vi.fn(() => mockSupabase),
      single: vi.fn(),
    };

    (createClient as any).mockReturnValue(mockSupabase);
    service = new ConsumptionService();
  });

  describe('getPreviousReading', () => {
    it('should fetch the previous reading for a customer', async () => {
      const mockReading = {
        id: 'reading-1',
        customer_id: 'customer-1',
        reading_value: 1000,
        reading_date: '2024-01-01T00:00:00Z',
        consumption: 100,
      };

      mockSupabase.single.mockResolvedValue({ data: mockReading, error: null });

      const result = await service.getPreviousReading(
        'customer-1',
        '2024-02-01T00:00:00Z'
      );

      expect(result).toEqual(mockReading);
      expect(mockSupabase.eq).toHaveBeenCalledWith('customer_id', 'customer-1');
      expect(mockSupabase.lt).toHaveBeenCalledWith('reading_date', '2024-02-01T00:00:00Z');
      expect(mockSupabase.order).toHaveBeenCalledWith('reading_date', { ascending: false });
    });

    it('should exclude specific reading ID when provided', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      await service.getPreviousReading(
        'customer-1',
        '2024-02-01T00:00:00Z',
        'exclude-id'
      );

      expect(mockSupabase.neq).toHaveBeenCalledWith('id', 'exclude-id');
    });

    it('should return null when no previous reading exists', async () => {
      mockSupabase.single.mockResolvedValue({ 
        data: null, 
        error: { code: 'PGRST116', message: 'No rows found' } 
      });

      const result = await service.getPreviousReading(
        'customer-1',
        '2024-02-01T00:00:00Z'
      );

      expect(result).toBeNull();
    });
  });

  describe('calculateConsumption', () => {
    it('should calculate positive consumption', () => {
      const result = service.calculateConsumption(1500, 1000);
      expect(result).toBe(500);
    });

    it('should return negative consumption for meter rollback', () => {
      const result = service.calculateConsumption(800, 1000);
      expect(result).toBe(-200);
    });

    it('should return null when previous value is null', () => {
      const result = service.calculateConsumption(1500, null);
      expect(result).toBeNull();
    });

    it('should handle zero consumption', () => {
      const result = service.calculateConsumption(1000, 1000);
      expect(result).toBe(0);
    });
  });

  describe('getConsumptionData', () => {
    it('should calculate comprehensive consumption data', async () => {
      const previousReading = {
        id: 'reading-1',
        customer_id: 'customer-1',
        reading_value: 1000,
        reading_date: '2024-01-01T00:00:00Z',
        consumption: 100,
      };

      mockSupabase.single.mockResolvedValue({ data: previousReading, error: null });

      const result = await service.getConsumptionData('customer-1', {
        value: 1500,
        date: '2024-02-01T00:00:00Z',
      });

      expect(result).toMatchObject({
        previousReading,
        consumption: 500,
        daysBetween: 31,
        dailyAverage: expect.closeTo(16.13, 2),
        percentageChange: 400, // (500 - 100) / 100 * 100
      });
    });

    it('should handle first reading with no previous data', async () => {
      mockSupabase.single.mockResolvedValue({ 
        data: null, 
        error: { code: 'PGRST116' } 
      });

      const result = await service.getConsumptionData('customer-1', {
        value: 1000,
        date: '2024-01-01T00:00:00Z',
      });

      expect(result).toMatchObject({
        previousReading: null,
        consumption: null,
        daysBetween: null,
        dailyAverage: null,
        percentageChange: null,
      });
    });
  });

  describe('getConsumptionHistory', () => {
    it('should fetch consumption history', async () => {
      const mockHistory = [
        { id: '1', consumption: 100, reading_date: '2024-03-01' },
        { id: '2', consumption: 120, reading_date: '2024-02-01' },
        { id: '3', consumption: 110, reading_date: '2024-01-01' },
      ];

      mockSupabase.limit.mockResolvedValue({ data: mockHistory, error: null });

      const result = await service.getConsumptionHistory('customer-1', 12);

      expect(result).toEqual(mockHistory);
      expect(mockSupabase.eq).toHaveBeenCalledWith('customer_id', 'customer-1');
      expect(mockSupabase.not).toHaveBeenCalledWith('consumption', 'is', null);
      expect(mockSupabase.limit).toHaveBeenCalledWith(12);
    });
  });

  describe('getConsumptionTrend', () => {
    it('should calculate consumption trend statistics', async () => {
      const mockHistory = [
        { consumption: 120, reading_date: '2024-06-01' },
        { consumption: 110, reading_date: '2024-05-01' },
        { consumption: 100, reading_date: '2024-04-01' },
        { consumption: 105, reading_date: '2024-03-01' },
        { consumption: 115, reading_date: '2024-02-01' },
        { consumption: 100, reading_date: '2024-01-01' },
      ];

      mockSupabase.limit.mockResolvedValue({ data: mockHistory, error: null });

      const result = await service.getConsumptionTrend('customer-1');

      expect(result).toMatchObject({
        average: expect.closeTo(108.33, 2),
        median: expect.closeTo(107.5, 1),
        min: 100,
        max: 120,
        standardDeviation: expect.any(Number),
        trend: expect.stringMatching(/^(increasing|decreasing|stable)$/),
      });
    });

    it('should return null with insufficient data', async () => {
      mockSupabase.limit.mockResolvedValue({ data: [], error: null });

      const result = await service.getConsumptionTrend('customer-1');
      expect(result).toBeNull();
    });

    it('should identify increasing trend', async () => {
      const mockHistory = [
        { consumption: 150, reading_date: '2024-06-01' },
        { consumption: 140, reading_date: '2024-05-01' },
        { consumption: 130, reading_date: '2024-04-01' },
        { consumption: 120, reading_date: '2024-03-01' },
        { consumption: 110, reading_date: '2024-02-01' },
        { consumption: 100, reading_date: '2024-01-01' },
      ];

      mockSupabase.limit.mockResolvedValue({ data: mockHistory, error: null });

      const result = await service.getConsumptionTrend('customer-1');
      expect(result?.trend).toBe('increasing');
    });
  });

  describe('estimateNextReading', () => {
    it('should estimate next reading based on history', async () => {
      const mockHistory = [
        { 
          reading_value: 1600, 
          consumption: 100, 
          reading_date: '2024-06-01T00:00:00Z' 
        },
        { 
          reading_value: 1500, 
          consumption: 100, 
          reading_date: '2024-05-01T00:00:00Z' 
        },
        { 
          reading_value: 1400, 
          consumption: 100, 
          reading_date: '2024-04-01T00:00:00Z' 
        },
      ];

      mockSupabase.limit.mockResolvedValue({ data: mockHistory, error: null });

      // Mock current date as 2024-07-01
      const targetDate = new Date('2024-07-01T00:00:00Z');
      const result = await service.estimateNextReading('customer-1', targetDate);

      expect(result).toMatchObject({
        estimatedValue: expect.any(Number),
        estimatedConsumption: expect.any(Number),
        confidence: expect.stringMatching(/^(high|medium|low)$/),
        basedOnReadings: 3,
      });

      // With consistent 100 consumption per month, next should be around 1700
      expect(result?.estimatedValue).toBeCloseTo(1700, 0);
    });

    it('should return null with insufficient history', async () => {
      mockSupabase.limit.mockResolvedValue({ data: [], error: null });

      const result = await service.estimateNextReading('customer-1');
      expect(result).toBeNull();
    });

    it('should have high confidence with consistent data', async () => {
      const mockHistory = Array.from({ length: 12 }, (_, i) => ({
        reading_value: 1200 - i * 100,
        consumption: 100,
        reading_date: new Date(2024, 5 - i, 1).toISOString(),
      }));

      mockSupabase.limit.mockResolvedValue({ data: mockHistory, error: null });

      const result = await service.estimateNextReading('customer-1');
      expect(result?.confidence).toBe('high');
    });
  });

  describe('isConsumptionNormal', () => {
    it('should identify normal consumption within expected range', async () => {
      const mockHistory = Array.from({ length: 12 }, () => ({
        consumption: 100 + Math.random() * 20 - 10, // 90-110 range
      }));

      mockSupabase.limit.mockResolvedValue({ data: mockHistory, error: null });

      const result = await service.isConsumptionNormal('customer-1', 105);
      
      expect(result.isNormal).toBe(true);
      expect(result.expectedRange).toBeDefined();
    });

    it('should flag unusually high consumption', async () => {
      const mockHistory = Array.from({ length: 12 }, () => ({
        consumption: 100,
      }));

      mockSupabase.limit.mockResolvedValue({ data: mockHistory, error: null });

      const result = await service.isConsumptionNormal('customer-1', 300);
      
      expect(result.isNormal).toBe(false);
      expect(result.reason).toContain('high consumption');
    });

    it('should flag negative consumption', async () => {
      const mockHistory = Array.from({ length: 12 }, () => ({
        consumption: 100,
      }));

      mockSupabase.limit.mockResolvedValue({ data: mockHistory, error: null });

      const result = await service.isConsumptionNormal('customer-1', -50);
      
      expect(result.isNormal).toBe(false);
      expect(result.reason).toContain('Negative consumption');
    });

    it('should return normal when no history available', async () => {
      mockSupabase.limit.mockResolvedValue({ data: [], error: null });

      const result = await service.isConsumptionNormal('customer-1', 100);
      
      expect(result.isNormal).toBe(true);
      expect(result.expectedRange).toBeUndefined();
    });
  });
});