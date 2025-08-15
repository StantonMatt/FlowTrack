import { createClient } from '@/lib/supabase/client';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';

export interface ConsumptionTrend {
  period: string;
  totalConsumption: number;
  averageConsumption: number;
  customerCount: number;
  readingCount: number;
  anomalyCount: number;
  percentageChange?: number;
}

export interface CustomerConsumptionTrend {
  customerId: string;
  customerName: string;
  periods: Array<{
    period: string;
    consumption: number;
    readingValue: number;
    anomaly?: string;
  }>;
  averageConsumption: number;
  totalConsumption: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  percentageChange: number;
}

export interface ConsumptionStatistics {
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  percentile25: number;
  percentile75: number;
  percentile95: number;
}

export class ConsumptionTrendsService {
  private supabase = createClient();

  /**
   * Get consumption trends for a tenant over time
   */
  async getTenantTrends(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    groupBy: 'day' | 'week' | 'month' = 'month'
  ): Promise<ConsumptionTrend[]> {
    const { data, error } = await this.supabase
      .rpc('get_consumption_trends', {
        p_tenant_id: tenantId,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
        p_group_by: groupBy,
      });

    if (error) {
      console.error('Error fetching consumption trends:', error);
      throw error;
    }

    // Calculate percentage changes
    const trends: ConsumptionTrend[] = [];
    for (let i = 0; i < data.length; i++) {
      const current = data[i];
      const previous = i > 0 ? data[i - 1] : null;
      
      let percentageChange;
      if (previous && previous.total_consumption > 0) {
        percentageChange = ((current.total_consumption - previous.total_consumption) / previous.total_consumption) * 100;
      }

      trends.push({
        period: current.period,
        totalConsumption: current.total_consumption,
        averageConsumption: current.average_consumption,
        customerCount: current.customer_count,
        readingCount: current.reading_count,
        anomalyCount: current.anomaly_count,
        percentageChange,
      });
    }

    return trends;
  }

  /**
   * Get consumption trends for a specific customer
   */
  async getCustomerTrends(
    customerId: string,
    months: number = 12
  ): Promise<CustomerConsumptionTrend> {
    const endDate = new Date();
    const startDate = subMonths(endDate, months);

    const { data: readings, error } = await this.supabase
      .from('meter_readings')
      .select('*')
      .eq('customer_id', customerId)
      .gte('reading_date', startDate.toISOString())
      .lte('reading_date', endDate.toISOString())
      .order('reading_date', { ascending: true });

    if (error) {
      console.error('Error fetching customer readings:', error);
      throw error;
    }

    // Get customer info
    const { data: customer } = await this.supabase
      .from('customers')
      .select('first_name, last_name')
      .eq('id', customerId)
      .single();

    // Group by month
    const periodMap = new Map<string, typeof readings>();
    readings?.forEach(reading => {
      const period = format(new Date(reading.reading_date), 'yyyy-MM');
      if (!periodMap.has(period)) {
        periodMap.set(period, []);
      }
      periodMap.get(period)!.push(reading);
    });

    // Calculate trends
    const periods = Array.from(periodMap.entries()).map(([period, periodReadings]) => {
      const totalConsumption = periodReadings.reduce((sum, r) => sum + (r.consumption || 0), 0);
      const lastReading = periodReadings[periodReadings.length - 1];
      
      return {
        period,
        consumption: totalConsumption,
        readingValue: lastReading.reading_value,
        anomaly: lastReading.anomaly_flag || undefined,
      };
    });

    // Calculate statistics
    const consumptions = periods.map(p => p.consumption);
    const totalConsumption = consumptions.reduce((sum, c) => sum + c, 0);
    const averageConsumption = consumptions.length > 0 ? totalConsumption / consumptions.length : 0;

    // Determine trend
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    let percentageChange = 0;
    
    if (periods.length >= 2) {
      const recentAvg = consumptions.slice(-3).reduce((sum, c) => sum + c, 0) / Math.min(3, consumptions.slice(-3).length);
      const olderAvg = consumptions.slice(0, 3).reduce((sum, c) => sum + c, 0) / Math.min(3, consumptions.length);
      
      if (olderAvg > 0) {
        percentageChange = ((recentAvg - olderAvg) / olderAvg) * 100;
        
        if (percentageChange > 10) {
          trend = 'increasing';
        } else if (percentageChange < -10) {
          trend = 'decreasing';
        }
      }
    }

    return {
      customerId,
      customerName: customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown',
      periods,
      averageConsumption,
      totalConsumption,
      trend,
      percentageChange,
    };
  }

  /**
   * Get consumption statistics for a tenant
   */
  async getConsumptionStatistics(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ConsumptionStatistics> {
    const { data, error } = await this.supabase
      .from('meter_readings')
      .select('consumption')
      .eq('tenant_id', tenantId)
      .gte('reading_date', startDate.toISOString())
      .lte('reading_date', endDate.toISOString())
      .not('consumption', 'is', null)
      .order('consumption', { ascending: true });

    if (error) {
      console.error('Error fetching consumption data:', error);
      throw error;
    }

    const values = data?.map(r => r.consumption) || [];
    
    if (values.length === 0) {
      return {
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        stdDev: 0,
        percentile25: 0,
        percentile75: 0,
        percentile95: 0,
      };
    }

    // Calculate statistics
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    
    // Median
    const median = values[Math.floor(values.length / 2)];
    
    // Standard deviation
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Percentiles
    const percentile25 = values[Math.floor(values.length * 0.25)];
    const percentile75 = values[Math.floor(values.length * 0.75)];
    const percentile95 = values[Math.floor(values.length * 0.95)];

    return {
      min,
      max,
      mean,
      median,
      stdDev,
      percentile25,
      percentile75,
      percentile95,
    };
  }

  /**
   * Get top consumers for a period
   */
  async getTopConsumers(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    limit: number = 10
  ): Promise<Array<{
    customerId: string;
    customerName: string;
    totalConsumption: number;
    readingCount: number;
    averageConsumption: number;
  }>> {
    const { data, error } = await this.supabase
      .rpc('get_top_consumers', {
        p_tenant_id: tenantId,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
        p_limit: limit,
      });

    if (error) {
      console.error('Error fetching top consumers:', error);
      throw error;
    }

    return data?.map(row => ({
      customerId: row.customer_id,
      customerName: row.customer_name,
      totalConsumption: row.total_consumption,
      readingCount: row.reading_count,
      averageConsumption: row.average_consumption,
    })) || [];
  }

  /**
   * Predict future consumption based on historical trends
   */
  async predictConsumption(
    customerId: string,
    months: number = 3
  ): Promise<Array<{
    period: string;
    predictedConsumption: number;
    confidenceLower: number;
    confidenceUpper: number;
  }>> {
    // Get historical data
    const historicalMonths = 12;
    const trend = await this.getCustomerTrends(customerId, historicalMonths);
    
    if (trend.periods.length < 3) {
      throw new Error('Insufficient historical data for prediction');
    }

    // Simple linear regression for prediction
    const x = trend.periods.map((_, i) => i);
    const y = trend.periods.map(p => p.consumption);
    
    const n = x.length;
    const sumX = x.reduce((sum, xi) => sum + xi, 0);
    const sumY = y.reduce((sum, yi) => sum + yi, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate standard error
    const yPred = x.map(xi => slope * xi + intercept);
    const residuals = y.map((yi, i) => yi - yPred[i]);
    const stdError = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (n - 2));
    
    // Generate predictions
    const predictions = [];
    const lastPeriod = new Date(trend.periods[trend.periods.length - 1].period + '-01');
    
    for (let i = 1; i <= months; i++) {
      const futureX = n - 1 + i;
      const predictedY = slope * futureX + intercept;
      const confidenceInterval = 1.96 * stdError; // 95% confidence
      
      const futurePeriod = new Date(lastPeriod);
      futurePeriod.setMonth(futurePeriod.getMonth() + i);
      
      predictions.push({
        period: format(futurePeriod, 'yyyy-MM'),
        predictedConsumption: Math.max(0, predictedY),
        confidenceLower: Math.max(0, predictedY - confidenceInterval),
        confidenceUpper: predictedY + confidenceInterval,
      });
    }

    return predictions;
  }

  /**
   * Detect seasonal patterns in consumption
   */
  async detectSeasonalPatterns(
    tenantId: string,
    years: number = 2
  ): Promise<{
    hasSeasonalPattern: boolean;
    peakMonths: string[];
    lowMonths: string[];
    seasonalFactor: Record<string, number>;
  }> {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setFullYear(startDate.getFullYear() - years);

    const trends = await this.getTenantTrends(tenantId, startDate, endDate, 'month');
    
    // Group by month across years
    const monthlyAverages = new Map<string, number[]>();
    
    trends.forEach(trend => {
      const month = trend.period.substring(5, 7); // Extract MM from yyyy-MM
      if (!monthlyAverages.has(month)) {
        monthlyAverages.set(month, []);
      }
      monthlyAverages.get(month)!.push(trend.averageConsumption);
    });

    // Calculate average for each month
    const monthlyMeans = new Map<string, number>();
    const overallValues: number[] = [];
    
    monthlyAverages.forEach((values, month) => {
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      monthlyMeans.set(month, mean);
      overallValues.push(...values);
    });

    // Calculate overall mean
    const overallMean = overallValues.reduce((sum, v) => sum + v, 0) / overallValues.length;
    
    // Calculate seasonal factors
    const seasonalFactor: Record<string, number> = {};
    const factors: number[] = [];
    
    monthlyMeans.forEach((mean, month) => {
      const factor = mean / overallMean;
      seasonalFactor[month] = factor;
      factors.push(factor);
    });

    // Determine if there's a significant seasonal pattern
    const maxFactor = Math.max(...factors);
    const minFactor = Math.min(...factors);
    const hasSeasonalPattern = (maxFactor - minFactor) > 0.3; // 30% variation threshold

    // Find peak and low months
    const sortedMonths = Array.from(monthlyMeans.entries())
      .sort((a, b) => b[1] - a[1]);
    
    const peakMonths = sortedMonths.slice(0, 3).map(([month]) => month);
    const lowMonths = sortedMonths.slice(-3).map(([month]) => month);

    return {
      hasSeasonalPattern,
      peakMonths,
      lowMonths,
      seasonalFactor,
    };
  }
}