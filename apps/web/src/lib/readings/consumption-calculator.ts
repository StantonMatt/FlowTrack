import { createClient } from '@/lib/supabase/client';
import Decimal from 'decimal.js';

export interface PreviousReading {
  reading_value: number;
  reading_date: string;
  id: string;
}

export interface ConsumptionResult {
  previous_value: number | null;
  previous_date: string | null;
  consumption: number | null;
  anomaly_flags: string[];
  error?: string;
}

export class ConsumptionCalculator {
  private supabase = createClient();

  /**
   * Fetch the last confirmed reading for a customer and calculate consumption
   */
  async calculateConsumption(
    tenantId: string,
    customerId: string,
    currentReadingValue: number,
    currentReadingDate: string
  ): Promise<ConsumptionResult> {
    try {
      // Fetch previous reading
      const previousReading = await this.fetchPreviousReading(
        tenantId,
        customerId,
        currentReadingDate
      );

      if (!previousReading) {
        // No previous reading - this is the first reading
        return {
          previous_value: null,
          previous_date: null,
          consumption: null,
          anomaly_flags: [],
        };
      }

      // Calculate consumption
      const consumption = this.computeConsumption(
        currentReadingValue,
        previousReading.reading_value
      );

      // Check for anomalies
      const anomalyFlags = this.detectAnomalies(
        consumption,
        previousReading.reading_value,
        currentReadingValue,
        previousReading.reading_date,
        currentReadingDate
      );

      return {
        previous_value: previousReading.reading_value,
        previous_date: previousReading.reading_date,
        consumption,
        anomaly_flags: anomalyFlags,
      };
    } catch (error) {
      console.error('Error calculating consumption:', error);
      return {
        previous_value: null,
        previous_date: null,
        consumption: null,
        anomaly_flags: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fetch the most recent reading prior to the current reading date
   */
  private async fetchPreviousReading(
    tenantId: string,
    customerId: string,
    currentReadingDate: string
  ): Promise<PreviousReading | null> {
    const { data, error } = await this.supabase
      .from('meter_readings')
      .select('id, reading_value, reading_date')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .lt('reading_date', currentReadingDate)
      .order('reading_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      throw new Error(`Failed to fetch previous reading: ${error.message}`);
    }

    return data;
  }

  /**
   * Compute consumption with proper decimal precision
   */
  private computeConsumption(
    currentValue: number,
    previousValue: number
  ): number {
    const current = new Decimal(currentValue);
    const previous = new Decimal(previousValue);
    const consumption = current.minus(previous);
    
    // Round to 3 decimal places for standard water meter precision
    return consumption.toDecimalPlaces(3).toNumber();
  }

  /**
   * Detect consumption anomalies
   */
  private detectAnomalies(
    consumption: number,
    previousValue: number,
    currentValue: number,
    previousDate: string,
    currentDate: string
  ): string[] {
    const flags: string[] = [];

    // Negative consumption (meter rollback)
    if (consumption < 0) {
      flags.push('negative_consumption');
    }

    // Zero consumption over extended period
    const daysBetween = this.daysBetweenDates(previousDate, currentDate);
    if (consumption === 0 && daysBetween > 30) {
      flags.push('zero_consumption_extended');
    }

    // Unusually high consumption
    const dailyAverage = consumption / daysBetween;
    if (dailyAverage > 1000) {
      // More than 1000 units per day
      flags.push('high_consumption');
    }

    // Potential leak detection (consistent high usage)
    if (dailyAverage > 500 && daysBetween >= 7) {
      flags.push('potential_leak');
    }

    // Large percentage increase
    if (previousValue > 0) {
      const percentageIncrease = ((currentValue - previousValue) / previousValue) * 100;
      if (percentageIncrease > 200) {
        flags.push('large_percentage_increase');
      }
    }

    // Meter tampering suspicion (large backward reading)
    if (consumption < -100) {
      flags.push('possible_tampering');
    }

    return flags;
  }

  /**
   * Calculate days between two dates
   */
  private daysBetweenDates(date1: string, date2: string): number {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Batch calculate consumption for multiple readings
   */
  async batchCalculateConsumption(
    readings: Array<{
      tenant_id: string;
      customer_id: string;
      reading_value: number;
      reading_date: string;
    }>
  ): Promise<Map<string, ConsumptionResult>> {
    const results = new Map<string, ConsumptionResult>();

    // Group by customer for efficient processing
    const customerGroups = new Map<string, typeof readings>();
    for (const reading of readings) {
      const key = `${reading.tenant_id}-${reading.customer_id}`;
      if (!customerGroups.has(key)) {
        customerGroups.set(key, []);
      }
      customerGroups.get(key)!.push(reading);
    }

    // Process each customer group
    for (const [customerKey, customerReadings] of customerGroups) {
      // Sort by date to process in order
      customerReadings.sort((a, b) => 
        new Date(a.reading_date).getTime() - new Date(b.reading_date).getTime()
      );

      for (const reading of customerReadings) {
        const result = await this.calculateConsumption(
          reading.tenant_id,
          reading.customer_id,
          reading.reading_value,
          reading.reading_date
        );
        
        const readingKey = `${reading.tenant_id}-${reading.customer_id}-${reading.reading_date}`;
        results.set(readingKey, result);
      }
    }

    return results;
  }

  /**
   * Get consumption statistics for a customer
   */
  async getConsumptionStatistics(
    tenantId: string,
    customerId: string,
    startDate?: string,
    endDate?: string
  ): Promise<{
    average_daily: number;
    total_consumption: number;
    reading_count: number;
    anomaly_count: number;
    min_consumption: number;
    max_consumption: number;
  }> {
    let query = this.supabase
      .from('meter_readings')
      .select('reading_value, reading_date, consumption, anomaly_flag')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('reading_date', { ascending: false });

    if (startDate) {
      query = query.gte('reading_date', startDate);
    }
    if (endDate) {
      query = query.lte('reading_date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch consumption statistics: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return {
        average_daily: 0,
        total_consumption: 0,
        reading_count: 0,
        anomaly_count: 0,
        min_consumption: 0,
        max_consumption: 0,
      };
    }

    // Calculate statistics
    const consumptions = data
      .map(r => r.consumption)
      .filter((c): c is number => c !== null);
    
    const totalConsumption = consumptions.reduce((sum, c) => sum + c, 0);
    const anomalyCount = data.filter(r => r.anomaly_flag).length;
    
    const firstDate = new Date(data[data.length - 1].reading_date);
    const lastDate = new Date(data[0].reading_date);
    const daySpan = Math.max(1, this.daysBetweenDates(
      firstDate.toISOString(),
      lastDate.toISOString()
    ));

    return {
      average_daily: totalConsumption / daySpan,
      total_consumption: totalConsumption,
      reading_count: data.length,
      anomaly_count: anomalyCount,
      min_consumption: consumptions.length > 0 ? Math.min(...consumptions) : 0,
      max_consumption: consumptions.length > 0 ? Math.max(...consumptions) : 0,
    };
  }
}