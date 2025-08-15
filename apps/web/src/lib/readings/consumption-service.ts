import { createClient } from '@/lib/supabase/client';
import type { Database } from '@shared/types/database.types';
import type { MeterReading } from '@shared/schemas/reading';

type DbReading = Database['public']['Tables']['meter_readings']['Row'];

export interface ConsumptionData {
  previousReading: DbReading | null;
  consumption: number | null;
  daysBetween: number | null;
  dailyAverage: number | null;
  percentageChange: number | null;
}

export interface ConsumptionTrend {
  average: number;
  median: number;
  min: number;
  max: number;
  standardDeviation: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export class ConsumptionService {
  private supabase = createClient();

  /**
   * Fetch the previous confirmed reading for a customer
   */
  async getPreviousReading(
    customerId: string,
    readingDate: Date | string,
    excludeReadingId?: string
  ): Promise<DbReading | null> {
    const date = typeof readingDate === 'string' ? readingDate : readingDate.toISOString();
    
    let query = this.supabase
      .from('meter_readings')
      .select('*')
      .eq('customer_id', customerId)
      .lt('reading_date', date)
      .order('reading_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    // Exclude specific reading ID if provided (for updates)
    if (excludeReadingId) {
      query = query.neq('id', excludeReadingId);
    }

    const { data, error } = await query.single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching previous reading:', error);
      throw error;
    }

    return data || null;
  }

  /**
   * Calculate consumption between two readings
   */
  calculateConsumption(
    currentValue: number,
    previousValue: number | null
  ): number | null {
    if (previousValue === null || previousValue === undefined) {
      return null;
    }

    // Basic consumption is current - previous
    const consumption = currentValue - previousValue;
    
    // Return null for negative consumption (meter rollback/reset)
    // This will be flagged as an anomaly
    if (consumption < 0) {
      console.warn(`Negative consumption detected: ${currentValue} - ${previousValue} = ${consumption}`);
    }

    return consumption;
  }

  /**
   * Calculate detailed consumption data including trends
   */
  async getConsumptionData(
    customerId: string,
    currentReading: {
      value: number;
      date: Date | string;
      id?: string;
    }
  ): Promise<ConsumptionData> {
    const previousReading = await this.getPreviousReading(
      customerId,
      currentReading.date,
      currentReading.id
    );

    if (!previousReading) {
      return {
        previousReading: null,
        consumption: null,
        daysBetween: null,
        dailyAverage: null,
        percentageChange: null,
      };
    }

    const consumption = this.calculateConsumption(
      currentReading.value,
      previousReading.reading_value
    );

    // Calculate days between readings
    const currentDate = new Date(currentReading.date);
    const previousDate = new Date(previousReading.reading_date);
    const daysBetween = Math.max(
      1,
      Math.round((currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    // Calculate daily average
    const dailyAverage = consumption !== null && daysBetween > 0
      ? consumption / daysBetween
      : null;

    // Calculate percentage change
    const percentageChange = consumption !== null && previousReading.consumption
      ? ((consumption - previousReading.consumption) / previousReading.consumption) * 100
      : null;

    return {
      previousReading,
      consumption,
      daysBetween,
      dailyAverage,
      percentageChange,
    };
  }

  /**
   * Get consumption history for trend analysis
   */
  async getConsumptionHistory(
    customerId: string,
    limit = 12
  ): Promise<DbReading[]> {
    const { data, error } = await this.supabase
      .from('meter_readings')
      .select('*')
      .eq('customer_id', customerId)
      .not('consumption', 'is', null)
      .order('reading_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching consumption history:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Calculate consumption trends and statistics
   */
  async getConsumptionTrend(
    customerId: string,
    periods = 12
  ): Promise<ConsumptionTrend | null> {
    const history = await this.getConsumptionHistory(customerId, periods);
    
    if (history.length < 3) {
      return null; // Not enough data for trend analysis
    }

    const consumptions = history
      .map(r => r.consumption)
      .filter((c): c is number => c !== null && c >= 0);

    if (consumptions.length === 0) {
      return null;
    }

    // Calculate statistics
    const sum = consumptions.reduce((a, b) => a + b, 0);
    const average = sum / consumptions.length;
    
    // Calculate median
    const sorted = [...consumptions].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    const min = Math.min(...consumptions);
    const max = Math.max(...consumptions);

    // Calculate standard deviation
    const squaredDiffs = consumptions.map(c => Math.pow(c - average, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / consumptions.length;
    const standardDeviation = Math.sqrt(avgSquaredDiff);

    // Determine trend (using linear regression on last 6 readings)
    const recentReadings = consumptions.slice(0, Math.min(6, consumptions.length));
    const trend = this.calculateTrend(recentReadings);

    return {
      average,
      median,
      min,
      max,
      standardDeviation,
      trend,
    };
  }

  /**
   * Calculate trend direction using simple linear regression
   */
  private calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 2) return 'stable';

    // Simple linear regression
    const n = values.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    
    const sumX = indices.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = indices.reduce((sum, x, i) => sum + x * values[i], 0);
    const sumX2 = indices.reduce((sum, x) => sum + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // Calculate percentage change relative to average
    const average = sumY / n;
    const slopePercentage = (slope / average) * 100;

    // Determine trend based on slope
    if (Math.abs(slopePercentage) < 5) {
      return 'stable'; // Less than 5% change
    }
    return slope > 0 ? 'decreasing' : 'increasing'; // Note: reversed because we're looking at recent first
  }

  /**
   * Estimate next reading value based on historical patterns
   */
  async estimateNextReading(
    customerId: string,
    targetDate?: Date
  ): Promise<{
    estimatedValue: number;
    estimatedConsumption: number;
    confidence: 'high' | 'medium' | 'low';
    basedOnReadings: number;
  } | null> {
    const history = await this.getConsumptionHistory(customerId, 24);
    
    if (history.length < 3) {
      return null; // Not enough data
    }

    const latestReading = history[0];
    const validConsumptions = history
      .slice(0, 12) // Use last 12 readings for estimation
      .map(r => r.consumption)
      .filter((c): c is number => c !== null && c >= 0);

    if (validConsumptions.length === 0) {
      return null;
    }

    // Calculate average consumption
    const avgConsumption = validConsumptions.reduce((a, b) => a + b, 0) / validConsumptions.length;
    
    // Calculate days since last reading
    const lastReadingDate = new Date(latestReading.reading_date);
    const estimateDate = targetDate || new Date();
    const daysSinceLastReading = Math.max(
      1,
      Math.round((estimateDate.getTime() - lastReadingDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    // Calculate average daily consumption from history
    const consumptionPeriods = history.slice(0, -1).map((reading, index) => {
      const nextReading = history[index + 1];
      if (!reading.consumption || reading.consumption <= 0) return null;
      
      const days = Math.max(
        1,
        Math.round(
          (new Date(reading.reading_date).getTime() - 
           new Date(nextReading.reading_date).getTime()) / (1000 * 60 * 60 * 24)
        )
      );
      
      return reading.consumption / days;
    }).filter((c): c is number => c !== null);

    const avgDailyConsumption = consumptionPeriods.length > 0
      ? consumptionPeriods.reduce((a, b) => a + b, 0) / consumptionPeriods.length
      : avgConsumption / 30; // Fallback to monthly average

    // Estimate consumption for the period
    const estimatedConsumption = avgDailyConsumption * daysSinceLastReading;
    const estimatedValue = latestReading.reading_value + estimatedConsumption;

    // Determine confidence based on data consistency
    const stdDev = this.calculateStandardDeviation(validConsumptions);
    const coefficientOfVariation = (stdDev / avgConsumption) * 100;
    
    let confidence: 'high' | 'medium' | 'low';
    if (coefficientOfVariation < 20 && validConsumptions.length >= 6) {
      confidence = 'high';
    } else if (coefficientOfVariation < 40 && validConsumptions.length >= 3) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      estimatedValue: Math.round(estimatedValue * 1000) / 1000, // Round to 3 decimals
      estimatedConsumption: Math.round(estimatedConsumption * 1000) / 1000,
      confidence,
      basedOnReadings: validConsumptions.length,
    };
  }

  /**
   * Calculate standard deviation
   */
  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Check if consumption is within expected range
   */
  async isConsumptionNormal(
    customerId: string,
    consumption: number
  ): Promise<{
    isNormal: boolean;
    reason?: string;
    expectedRange?: { min: number; max: number };
  }> {
    const trend = await this.getConsumptionTrend(customerId);
    
    if (!trend) {
      // Not enough history, can't determine
      return { isNormal: true };
    }

    // Define normal range as mean ± 2 standard deviations
    const lowerBound = Math.max(0, trend.average - 2 * trend.standardDeviation);
    const upperBound = trend.average + 2 * trend.standardDeviation;

    const expectedRange = {
      min: Math.round(lowerBound * 1000) / 1000,
      max: Math.round(upperBound * 1000) / 1000,
    };

    if (consumption < 0) {
      return {
        isNormal: false,
        reason: 'Negative consumption detected',
        expectedRange,
      };
    }

    if (consumption < lowerBound) {
      return {
        isNormal: false,
        reason: `Unusually low consumption (${Math.round(((consumption - trend.average) / trend.average) * 100)}% below average)`,
        expectedRange,
      };
    }

    if (consumption > upperBound) {
      return {
        isNormal: false,
        reason: `Unusually high consumption (${Math.round(((consumption - trend.average) / trend.average) * 100)}% above average)`,
        expectedRange,
      };
    }

    return {
      isNormal: true,
      expectedRange,
    };
  }
}

// Export singleton instance
export const consumptionService = new ConsumptionService();