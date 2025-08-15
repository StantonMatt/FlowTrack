import { createClient } from '@/lib/supabase/client';
import Decimal from 'decimal.js';

export interface AnomalyRule {
  id: string;
  tenant_id: string;
  name: string;
  rule_type: string;
  parameters: Record<string, any>;
  is_active: boolean;
}

export interface AnomalyCheckResult {
  passed: boolean;
  triggered_rules: Array<{
    rule_id: string;
    rule_name: string;
    rule_type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    details?: Record<string, any>;
  }>;
  anomaly_score: number;
}

export class AnomalyRulesEngine {
  private supabase = createClient();
  private rulesCache = new Map<string, AnomalyRule[]>();
  private cacheExpiry = 5 * 60 * 1000; // 5 minutes
  private lastCacheTime = new Map<string, number>();

  /**
   * Check a reading against all active anomaly rules for the tenant
   */
  async checkReading(
    tenantId: string,
    customerId: string,
    readingValue: number,
    readingDate: string,
    previousValue?: number | null,
    previousDate?: string | null,
    consumption?: number | null
  ): Promise<AnomalyCheckResult> {
    const rules = await this.getRulesForTenant(tenantId);
    const triggeredRules: AnomalyCheckResult['triggered_rules'] = [];
    let anomalyScore = 0;

    for (const rule of rules) {
      const result = await this.evaluateRule(
        rule,
        {
          tenantId,
          customerId,
          readingValue,
          readingDate,
          previousValue,
          previousDate,
          consumption,
        }
      );

      if (result.triggered) {
        triggeredRules.push({
          rule_id: rule.id,
          rule_name: rule.name,
          rule_type: rule.rule_type,
          severity: result.severity || 'medium',
          message: result.message,
          details: result.details,
        });
        
        // Add to anomaly score based on severity
        anomalyScore += this.getSeverityScore(result.severity || 'medium');
      }
    }

    return {
      passed: triggeredRules.length === 0,
      triggered_rules: triggeredRules,
      anomaly_score: Math.min(100, anomalyScore), // Cap at 100
    };
  }

  /**
   * Get active rules for a tenant (with caching)
   */
  private async getRulesForTenant(tenantId: string): Promise<AnomalyRule[]> {
    // Check cache
    const cached = this.rulesCache.get(tenantId);
    const cacheTime = this.lastCacheTime.get(tenantId) || 0;
    
    if (cached && Date.now() - cacheTime < this.cacheExpiry) {
      return cached;
    }

    // Fetch from database
    const { data, error } = await this.supabase
      .from('anomaly_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching anomaly rules:', error);
      return [];
    }

    // Update cache
    this.rulesCache.set(tenantId, data || []);
    this.lastCacheTime.set(tenantId, Date.now());

    return data || [];
  }

  /**
   * Evaluate a single rule against reading data
   */
  private async evaluateRule(
    rule: AnomalyRule,
    context: {
      tenantId: string;
      customerId: string;
      readingValue: number;
      readingDate: string;
      previousValue?: number | null;
      previousDate?: string | null;
      consumption?: number | null;
    }
  ): Promise<{
    triggered: boolean;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    details?: Record<string, any>;
  }> {
    switch (rule.rule_type) {
      case 'consumption_threshold':
        return this.evaluateConsumptionThreshold(rule, context);
      
      case 'percentage_change':
        return this.evaluatePercentageChange(rule, context);
      
      case 'negative_consumption':
        return this.evaluateNegativeConsumption(rule, context);
      
      case 'zero_consumption':
        return this.evaluateZeroConsumption(rule, context);
      
      case 'time_based_pattern':
        return this.evaluateTimeBasedPattern(rule, context);
      
      case 'statistical_outlier':
        return this.evaluateStatisticalOutlier(rule, context);
      
      case 'meter_rollback':
        return this.evaluateMeterRollback(rule, context);
      
      case 'leak_detection':
        return this.evaluateLeakDetection(rule, context);
      
      default:
        return {
          triggered: false,
          message: `Unknown rule type: ${rule.rule_type}`,
        };
    }
  }

  /**
   * Evaluate consumption threshold rule
   */
  private evaluateConsumptionThreshold(
    rule: AnomalyRule,
    context: any
  ): { triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any } {
    if (context.consumption === null || context.consumption === undefined) {
      return { triggered: false, message: 'No consumption data available' };
    }

    const { min_threshold, max_threshold, severity = 'medium' } = rule.parameters;
    
    if (min_threshold !== undefined && context.consumption < min_threshold) {
      return {
        triggered: true,
        severity,
        message: `Consumption ${context.consumption} is below minimum threshold ${min_threshold}`,
        details: { consumption: context.consumption, min_threshold },
      };
    }

    if (max_threshold !== undefined && context.consumption > max_threshold) {
      return {
        triggered: true,
        severity,
        message: `Consumption ${context.consumption} exceeds maximum threshold ${max_threshold}`,
        details: { consumption: context.consumption, max_threshold },
      };
    }

    return { triggered: false, message: 'Consumption within thresholds' };
  }

  /**
   * Evaluate percentage change rule
   */
  private evaluatePercentageChange(
    rule: AnomalyRule,
    context: any
  ): { triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any } {
    if (!context.previousValue || context.previousValue === 0) {
      return { triggered: false, message: 'No previous value for comparison' };
    }

    const { max_increase_pct, max_decrease_pct, severity = 'medium' } = rule.parameters;
    
    const percentChange = ((context.readingValue - context.previousValue) / context.previousValue) * 100;

    if (max_increase_pct !== undefined && percentChange > max_increase_pct) {
      return {
        triggered: true,
        severity,
        message: `Reading increased by ${percentChange.toFixed(1)}%, exceeds ${max_increase_pct}% limit`,
        details: { percent_change: percentChange, limit: max_increase_pct },
      };
    }

    if (max_decrease_pct !== undefined && percentChange < -max_decrease_pct) {
      return {
        triggered: true,
        severity,
        message: `Reading decreased by ${Math.abs(percentChange).toFixed(1)}%, exceeds ${max_decrease_pct}% limit`,
        details: { percent_change: percentChange, limit: max_decrease_pct },
      };
    }

    return { triggered: false, message: 'Percentage change within limits' };
  }

  /**
   * Evaluate negative consumption rule
   */
  private evaluateNegativeConsumption(
    rule: AnomalyRule,
    context: any
  ): { triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any } {
    if (context.consumption === null || context.consumption === undefined) {
      return { triggered: false, message: 'No consumption data' };
    }

    const { threshold = 0, severity = 'high' } = rule.parameters;

    if (context.consumption < threshold) {
      return {
        triggered: true,
        severity,
        message: `Negative consumption detected: ${context.consumption}`,
        details: { consumption: context.consumption },
      };
    }

    return { triggered: false, message: 'No negative consumption' };
  }

  /**
   * Evaluate zero consumption rule
   */
  private evaluateZeroConsumption(
    rule: AnomalyRule,
    context: any
  ): { triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any } {
    if (context.consumption === null || context.consumption === undefined) {
      return { triggered: false, message: 'No consumption data' };
    }

    const { min_days = 30, severity = 'low' } = rule.parameters;

    if (context.consumption === 0 && context.previousDate) {
      const daysBetween = this.daysBetweenDates(context.previousDate, context.readingDate);
      
      if (daysBetween >= min_days) {
        return {
          triggered: true,
          severity,
          message: `Zero consumption for ${daysBetween} days`,
          details: { days: daysBetween, min_days },
        };
      }
    }

    return { triggered: false, message: 'Zero consumption check passed' };
  }

  /**
   * Evaluate time-based pattern rule
   */
  private async evaluateTimeBasedPattern(
    rule: AnomalyRule,
    context: any
  ): Promise<{ triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any }> {
    const { pattern_type, expected_range, severity = 'medium' } = rule.parameters;
    
    // Get historical data for pattern analysis
    const historicalData = await this.getHistoricalData(
      context.tenantId,
      context.customerId,
      context.readingDate,
      90 // Last 90 days
    );

    if (historicalData.length < 3) {
      return { triggered: false, message: 'Insufficient historical data for pattern analysis' };
    }

    switch (pattern_type) {
      case 'seasonal':
        return this.evaluateSeasonalPattern(historicalData, context, expected_range, severity);
      
      case 'weekly':
        return this.evaluateWeeklyPattern(historicalData, context, expected_range, severity);
      
      default:
        return { triggered: false, message: 'Unknown pattern type' };
    }
  }

  /**
   * Evaluate statistical outlier rule
   */
  private async evaluateStatisticalOutlier(
    rule: AnomalyRule,
    context: any
  ): Promise<{ triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any }> {
    const { std_deviations = 2, severity = 'medium' } = rule.parameters;
    
    // Get historical consumption data
    const historicalData = await this.getHistoricalData(
      context.tenantId,
      context.customerId,
      context.readingDate,
      180 // Last 6 months
    );

    if (historicalData.length < 10 || context.consumption === null) {
      return { triggered: false, message: 'Insufficient data for statistical analysis' };
    }

    const consumptions = historicalData
      .map(d => d.consumption)
      .filter((c): c is number => c !== null);
    
    const stats = this.calculateStatistics(consumptions);
    
    if (stats.stdDev === 0) {
      return { triggered: false, message: 'No variance in historical data' };
    }

    const zScore = Math.abs((context.consumption - stats.mean) / stats.stdDev);
    
    if (zScore > std_deviations) {
      return {
        triggered: true,
        severity,
        message: `Consumption is ${zScore.toFixed(1)} standard deviations from mean`,
        details: {
          consumption: context.consumption,
          mean: stats.mean,
          std_dev: stats.stdDev,
          z_score: zScore,
        },
      };
    }

    return { triggered: false, message: 'Consumption within statistical norms' };
  }

  /**
   * Evaluate meter rollback rule
   */
  private evaluateMeterRollback(
    rule: AnomalyRule,
    context: any
  ): { triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any } {
    if (!context.previousValue) {
      return { triggered: false, message: 'No previous reading for rollback check' };
    }

    const { max_rollback = 0, severity = 'critical' } = rule.parameters;
    const rollback = context.previousValue - context.readingValue;

    if (rollback > max_rollback) {
      return {
        triggered: true,
        severity,
        message: `Meter rollback detected: ${rollback} units`,
        details: {
          current_reading: context.readingValue,
          previous_reading: context.previousValue,
          rollback_amount: rollback,
        },
      };
    }

    return { triggered: false, message: 'No meter rollback detected' };
  }

  /**
   * Evaluate leak detection rule
   */
  private async evaluateLeakDetection(
    rule: AnomalyRule,
    context: any
  ): Promise<{ triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any }> {
    const { 
      min_daily_usage = 500,
      consecutive_days = 7,
      severity = 'high'
    } = rule.parameters;

    // Get recent readings
    const recentData = await this.getHistoricalData(
      context.tenantId,
      context.customerId,
      context.readingDate,
      consecutive_days * 2 // Get more data to ensure we have enough
    );

    if (recentData.length < consecutive_days) {
      return { triggered: false, message: 'Insufficient data for leak detection' };
    }

    // Check for consistent high usage
    let consecutiveHighUsage = 0;
    let totalConsumption = 0;
    let daysCounted = 0;

    for (let i = 0; i < recentData.length - 1 && daysCounted < consecutive_days; i++) {
      const consumption = recentData[i].consumption;
      if (consumption === null) continue;

      const days = this.daysBetweenDates(
        recentData[i + 1].reading_date,
        recentData[i].reading_date
      );
      
      const dailyUsage = consumption / days;
      
      if (dailyUsage >= min_daily_usage) {
        consecutiveHighUsage++;
        totalConsumption += consumption;
        daysCounted += days;
      } else {
        break; // Reset if pattern breaks
      }
    }

    if (consecutiveHighUsage >= consecutive_days / 2) {
      const avgDailyUsage = totalConsumption / daysCounted;
      return {
        triggered: true,
        severity,
        message: `Potential leak detected: ${avgDailyUsage.toFixed(0)} units/day average over ${daysCounted} days`,
        details: {
          avg_daily_usage: avgDailyUsage,
          days_analyzed: daysCounted,
          total_consumption: totalConsumption,
        },
      };
    }

    return { triggered: false, message: 'No leak pattern detected' };
  }

  /**
   * Helper: Get historical reading data
   */
  private async getHistoricalData(
    tenantId: string,
    customerId: string,
    beforeDate: string,
    days: number
  ): Promise<Array<{ reading_date: string; consumption: number | null }>> {
    const startDate = new Date(beforeDate);
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await this.supabase
      .from('meter_readings')
      .select('reading_date, consumption')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .gte('reading_date', startDate.toISOString().split('T')[0])
      .lt('reading_date', beforeDate)
      .order('reading_date', { ascending: false });

    if (error) {
      console.error('Error fetching historical data:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Helper: Evaluate seasonal pattern
   */
  private evaluateSeasonalPattern(
    historicalData: any[],
    context: any,
    expectedRange: { min: number; max: number },
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): { triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any } {
    // Simple seasonal check - compare to same month last year or average
    const currentMonth = new Date(context.readingDate).getMonth();
    const sameMonthData = historicalData.filter(d => 
      new Date(d.reading_date).getMonth() === currentMonth
    );

    if (sameMonthData.length === 0 || context.consumption === null) {
      return { triggered: false, message: 'No seasonal data for comparison' };
    }

    const avgConsumption = sameMonthData.reduce((sum, d) => sum + (d.consumption || 0), 0) / sameMonthData.length;
    
    if (context.consumption < expectedRange.min * avgConsumption || 
        context.consumption > expectedRange.max * avgConsumption) {
      return {
        triggered: true,
        severity,
        message: `Consumption outside seasonal range: ${context.consumption} vs expected ${avgConsumption.toFixed(0)}`,
        details: {
          consumption: context.consumption,
          seasonal_average: avgConsumption,
          expected_range: expectedRange,
        },
      };
    }

    return { triggered: false, message: 'Consumption within seasonal patterns' };
  }

  /**
   * Helper: Evaluate weekly pattern
   */
  private evaluateWeeklyPattern(
    historicalData: any[],
    context: any,
    expectedRange: { min: number; max: number },
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): { triggered: boolean; severity?: 'low' | 'medium' | 'high' | 'critical'; message: string; details?: any } {
    // Compare to recent weekly average
    const recentWeeks = historicalData.slice(0, 4); // Last 4 readings
    
    if (recentWeeks.length < 2 || context.consumption === null) {
      return { triggered: false, message: 'Insufficient weekly data' };
    }

    const avgWeeklyConsumption = recentWeeks.reduce((sum, d) => sum + (d.consumption || 0), 0) / recentWeeks.length;
    
    if (context.consumption < expectedRange.min * avgWeeklyConsumption || 
        context.consumption > expectedRange.max * avgWeeklyConsumption) {
      return {
        triggered: true,
        severity,
        message: `Consumption outside weekly pattern: ${context.consumption} vs average ${avgWeeklyConsumption.toFixed(0)}`,
        details: {
          consumption: context.consumption,
          weekly_average: avgWeeklyConsumption,
          expected_range: expectedRange,
        },
      };
    }

    return { triggered: false, message: 'Consumption within weekly patterns' };
  }

  /**
   * Helper: Calculate statistics
   */
  private calculateStatistics(values: number[]): { mean: number; stdDev: number } {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return { mean, stdDev };
  }

  /**
   * Helper: Calculate days between dates
   */
  private daysBetweenDates(date1: string, date2: string): number {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Helper: Get severity score
   */
  private getSeverityScore(severity: 'low' | 'medium' | 'high' | 'critical'): number {
    switch (severity) {
      case 'low': return 10;
      case 'medium': return 25;
      case 'high': return 50;
      case 'critical': return 100;
      default: return 25;
    }
  }

  /**
   * Create default rules for a tenant
   */
  async createDefaultRules(tenantId: string): Promise<void> {
    const defaultRules = [
      {
        tenant_id: tenantId,
        name: 'High Consumption Alert',
        rule_type: 'consumption_threshold',
        parameters: {
          max_threshold: 1000,
          severity: 'high',
        },
        is_active: true,
      },
      {
        tenant_id: tenantId,
        name: 'Negative Consumption Detection',
        rule_type: 'negative_consumption',
        parameters: {
          threshold: -10,
          severity: 'critical',
        },
        is_active: true,
      },
      {
        tenant_id: tenantId,
        name: 'Potential Leak Detection',
        rule_type: 'leak_detection',
        parameters: {
          min_daily_usage: 500,
          consecutive_days: 7,
          severity: 'high',
        },
        is_active: true,
      },
      {
        tenant_id: tenantId,
        name: 'Large Percentage Increase',
        rule_type: 'percentage_change',
        parameters: {
          max_increase_pct: 200,
          severity: 'medium',
        },
        is_active: true,
      },
      {
        tenant_id: tenantId,
        name: 'Statistical Outlier Detection',
        rule_type: 'statistical_outlier',
        parameters: {
          std_deviations: 3,
          severity: 'medium',
        },
        is_active: true,
      },
      {
        tenant_id: tenantId,
        name: 'Extended Zero Consumption',
        rule_type: 'zero_consumption',
        parameters: {
          min_days: 30,
          severity: 'low',
        },
        is_active: true,
      },
      {
        tenant_id: tenantId,
        name: 'Meter Rollback Detection',
        rule_type: 'meter_rollback',
        parameters: {
          max_rollback: 10,
          severity: 'critical',
        },
        is_active: true,
      },
    ];

    const { error } = await this.supabase
      .from('anomaly_rules')
      .insert(defaultRules);

    if (error) {
      console.error('Error creating default rules:', error);
      throw new Error('Failed to create default anomaly rules');
    }
  }

  /**
   * Clear rules cache for a tenant
   */
  clearCache(tenantId?: string): void {
    if (tenantId) {
      this.rulesCache.delete(tenantId);
      this.lastCacheTime.delete(tenantId);
    } else {
      this.rulesCache.clear();
      this.lastCacheTime.clear();
    }
  }
}