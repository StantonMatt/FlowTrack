import { createClient } from '@/lib/supabase/client';
import type { Database } from '@shared/types/database.types';
import type { ValidationRules, AnomalyFlag } from '@shared/schemas/reading';

type DbValidationRules = Database['public']['Tables']['validation_rules']['Row'];

export interface AnomalyResult {
  flag: AnomalyFlag | null;
  reasons: string[];
  suggestions: string[];
  rules: DbValidationRules | null;
}

export interface AnomalyStatistics {
  totalReadings: number;
  totalAnomalies: number;
  anomalyRate: number;
  byType: {
    negative: number;
    low: number;
    high: number;
  };
  commonReasons: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
}

export class AnomalyService {
  private supabase = createClient();
  private rulesCache = new Map<string, { rules: DbValidationRules | null; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get active validation rules for a tenant
   */
  async getValidationRules(
    tenantId: string,
    effectiveDate: Date = new Date()
  ): Promise<DbValidationRules | null> {
    // Check cache first
    const cacheKey = `${tenantId}-${effectiveDate.toISOString()}`;
    const cached = this.rulesCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.rules;
    }

    const { data, error } = await this.supabase
      .from('validation_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .lte('effective_from', effectiveDate.toISOString())
      .or(`effective_to.is.null,effective_to.gt.${effectiveDate.toISOString()}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching validation rules:', error);
      throw error;
    }

    const rules = data || null;
    
    // Cache the result
    this.rulesCache.set(cacheKey, { rules, timestamp: Date.now() });
    
    return rules;
  }

  /**
   * Create or update validation rules
   */
  async upsertValidationRules(
    tenantId: string,
    rules: Partial<ValidationRules>
  ): Promise<DbValidationRules> {
    // Clear cache for this tenant
    this.clearCacheForTenant(tenantId);

    const { data, error } = await this.supabase
      .from('validation_rules')
      .upsert({
        tenant_id: tenantId,
        low_threshold: rules.lowThreshold ?? 0,
        high_threshold: rules.highThreshold ?? 10000,
        min_delta_pct: rules.minDeltaPct ?? -50,
        max_delta_pct: rules.maxDeltaPct ?? 200,
        effective_from: rules.effectiveFrom ?? new Date().toISOString(),
        effective_to: rules.effectiveTo ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error upserting validation rules:', error);
      throw error;
    }

    return data;
  }

  /**
   * Evaluate if a consumption value is anomalous
   */
  async evaluateAnomaly(
    tenantId: string,
    consumption: number | null,
    previousConsumption: number | null,
    readingDate: Date = new Date()
  ): Promise<AnomalyResult> {
    const reasons: string[] = [];
    const suggestions: string[] = [];

    // Get validation rules
    const rules = await this.getValidationRules(tenantId, readingDate);
    
    // Use defaults if no rules found
    const effectiveRules = rules || {
      low_threshold: 0,
      high_threshold: 10000,
      min_delta_pct: -50,
      max_delta_pct: 200,
    };

    if (consumption === null) {
      return {
        flag: null,
        reasons,
        suggestions,
        rules,
      };
    }

    // Check for negative consumption
    if (consumption < 0) {
      reasons.push('Negative consumption detected');
      suggestions.push('Check if meter was replaced or reset');
      suggestions.push('Verify reading values are correct');
      return {
        flag: 'negative',
        reasons,
        suggestions,
        rules,
      };
    }

    // Check absolute thresholds
    if (consumption > effectiveRules.high_threshold) {
      reasons.push(`Consumption (${consumption}) exceeds high threshold (${effectiveRules.high_threshold})`);
      suggestions.push('Check for leaks or unauthorized usage');
      suggestions.push('Verify meter reading is correct');
      return {
        flag: 'high',
        reasons,
        suggestions,
        rules,
      };
    }

    if (consumption < effectiveRules.low_threshold) {
      reasons.push(`Consumption (${consumption}) below low threshold (${effectiveRules.low_threshold})`);
      suggestions.push('Check if property was vacant');
      suggestions.push('Verify meter is functioning properly');
      return {
        flag: 'low',
        reasons,
        suggestions,
        rules,
      };
    }

    // Check percentage change if previous consumption exists
    if (previousConsumption !== null && previousConsumption > 0) {
      const deltaPercentage = ((consumption - previousConsumption) / previousConsumption) * 100;

      if (deltaPercentage > effectiveRules.max_delta_pct) {
        reasons.push(`Consumption increased by ${Math.round(deltaPercentage)}% (max allowed: ${effectiveRules.max_delta_pct}%)`);
        suggestions.push('Check for new appliances or increased usage');
        suggestions.push('Investigate potential leaks');
        return {
          flag: 'high',
          reasons,
          suggestions,
          rules,
        };
      }

      if (deltaPercentage < effectiveRules.min_delta_pct) {
        reasons.push(`Consumption decreased by ${Math.abs(Math.round(deltaPercentage))}% (min allowed: ${effectiveRules.min_delta_pct}%)`);
        suggestions.push('Check if property usage has changed');
        suggestions.push('Verify meter is recording properly');
        return {
          flag: 'low',
          reasons,
          suggestions,
          rules,
        };
      }
    }

    return {
      flag: null,
      reasons,
      suggestions,
      rules,
    };
  }

  /**
   * Get anomaly statistics for a tenant
   */
  async getAnomalyStatistics(
    tenantId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AnomalyStatistics> {
    let query = this.supabase
      .from('meter_readings')
      .select('anomaly_flag, metadata')
      .eq('tenant_id', tenantId);

    if (startDate) {
      query = query.gte('reading_date', startDate.toISOString());
    }
    if (endDate) {
      query = query.lte('reading_date', endDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching anomaly statistics:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return {
        totalReadings: 0,
        totalAnomalies: 0,
        anomalyRate: 0,
        byType: { negative: 0, low: 0, high: 0 },
        commonReasons: [],
      };
    }

    const totalReadings = data.length;
    const anomalies = data.filter(r => r.anomaly_flag !== null);
    const totalAnomalies = anomalies.length;

    // Count by type
    const byType = anomalies.reduce(
      (acc, r) => {
        const flag = r.anomaly_flag as AnomalyFlag;
        acc[flag] = (acc[flag] || 0) + 1;
        return acc;
      },
      { negative: 0, low: 0, high: 0 }
    );

    // Extract and count reasons
    const reasonCounts = new Map<string, number>();
    anomalies.forEach(r => {
      const reasons = (r.metadata as any)?.anomalyReasons as string[] | undefined;
      if (reasons) {
        reasons.forEach(reason => {
          reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
        });
      }
    });

    // Convert to sorted array
    const commonReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: (count / totalAnomalies) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 reasons

    return {
      totalReadings,
      totalAnomalies,
      anomalyRate: (totalAnomalies / totalReadings) * 100,
      byType,
      commonReasons,
    };
  }

  /**
   * Review and potentially clear anomaly flags
   */
  async reviewAnomaly(
    readingId: string,
    action: 'approve' | 'clear' | 'investigate',
    notes?: string
  ): Promise<void> {
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (action === 'clear') {
      updateData.anomaly_flag = null;
    }

    // Add review metadata
    const { data: currentReading } = await this.supabase
      .from('meter_readings')
      .select('metadata')
      .eq('id', readingId)
      .single();

    if (currentReading) {
      updateData.metadata = {
        ...(currentReading.metadata || {}),
        anomalyReview: {
          action,
          notes,
          reviewedAt: new Date().toISOString(),
          reviewedBy: 'current_user', // This would come from auth context
        },
      };
    }

    const { error } = await this.supabase
      .from('meter_readings')
      .update(updateData)
      .eq('id', readingId);

    if (error) {
      console.error('Error reviewing anomaly:', error);
      throw error;
    }
  }

  /**
   * Get readings with anomalies for review
   */
  async getAnomalousReadings(
    tenantId: string,
    limit = 20,
    offset = 0
  ): Promise<Array<Database['public']['Tables']['meter_readings']['Row']>> {
    const { data, error } = await this.supabase
      .from('meter_readings')
      .select(`
        *,
        customers!inner(
          id,
          account_number,
          full_name,
          billing_address
        )
      `)
      .eq('tenant_id', tenantId)
      .not('anomaly_flag', 'is', null)
      .order('reading_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching anomalous readings:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Suggest actions for anomalous readings
   */
  getSuggestedActions(flag: AnomalyFlag, consumption: number): string[] {
    const actions: string[] = [];

    switch (flag) {
      case 'negative':
        actions.push('Verify current and previous reading values');
        actions.push('Check if meter was replaced or reset');
        actions.push('Contact customer to confirm meter status');
        actions.push('Schedule on-site inspection if needed');
        break;

      case 'high':
        actions.push('Alert customer about unusually high consumption');
        actions.push('Suggest checking for leaks');
        actions.push('Review historical consumption patterns');
        actions.push('Consider scheduling meter inspection');
        if (consumption > 50000) {
          actions.push('Flag for immediate investigation');
        }
        break;

      case 'low':
        actions.push('Verify meter is functioning correctly');
        actions.push('Check if property is vacant or has reduced usage');
        actions.push('Confirm reading was taken correctly');
        actions.push('Review account status');
        break;
    }

    return actions;
  }

  /**
   * Clear cache for a specific tenant
   */
  private clearCacheForTenant(tenantId: string): void {
    for (const key of this.rulesCache.keys()) {
      if (key.startsWith(tenantId)) {
        this.rulesCache.delete(key);
      }
    }
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.rulesCache.clear();
  }
}

// Export singleton instance
export const anomalyService = new AnomalyService();