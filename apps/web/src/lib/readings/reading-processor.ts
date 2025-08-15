import { consumptionService } from './consumption-service';
import { anomalyService } from './anomaly-service';
import type { CreateReading, MeterReading } from '@shared/schemas/reading';
import type { Database } from '@shared/types/database.types';

type DbReading = Database['public']['Tables']['meter_readings']['Row'];
type DbReadingInsert = Database['public']['Tables']['meter_readings']['Insert'];

export interface ProcessedReading {
  reading: DbReadingInsert;
  previousReading: DbReading | null;
  consumption: number | null;
  anomalyFlag: string | null;
  anomalyReasons: string[];
  warnings: string[];
}

export interface ProcessingOptions {
  skipAnomalyCheck?: boolean;
  skipConsumptionCalc?: boolean;
  allowNegativeConsumption?: boolean;
  source?: 'manual' | 'bulk' | 'offline' | 'import' | 'api';
}

export class ReadingProcessor {
  /**
   * Process a meter reading with consumption calculation and anomaly detection
   */
  async processReading(
    tenantId: string,
    reading: CreateReading,
    options: ProcessingOptions = {}
  ): Promise<ProcessedReading> {
    const warnings: string[] = [];
    const anomalyReasons: string[] = [];

    // Get previous reading and calculate consumption
    let previousReading: DbReading | null = null;
    let consumption: number | null = null;

    if (!options.skipConsumptionCalc) {
      const consumptionData = await consumptionService.getConsumptionData(
        reading.customerId,
        {
          value: reading.readingValue,
          date: reading.readingDate,
        }
      );

      previousReading = consumptionData.previousReading;
      consumption = consumptionData.consumption;

      // Add warnings for unusual consumption patterns
      if (consumption !== null) {
        if (consumption < 0 && !options.allowNegativeConsumption) {
          warnings.push(`Negative consumption detected: ${consumption}. Meter may have been reset or replaced.`);
          anomalyReasons.push('Negative consumption');
        }

        if (consumptionData.daysBetween && consumptionData.daysBetween > 45) {
          warnings.push(`Long period between readings: ${consumptionData.daysBetween} days`);
        }

        if (consumptionData.percentageChange && Math.abs(consumptionData.percentageChange) > 200) {
          warnings.push(`Large consumption change: ${Math.round(consumptionData.percentageChange)}% from previous period`);
          anomalyReasons.push(`${consumptionData.percentageChange > 0 ? 'Spike' : 'Drop'} in consumption`);
        }
      }
    }

    // Check for anomalies
    let anomalyFlag: string | null = null;

    if (!options.skipAnomalyCheck && consumption !== null) {
      const anomalyResult = await anomalyService.evaluateAnomaly(
        tenantId,
        consumption,
        previousReading?.consumption ?? null,
        new Date(reading.readingDate)
      );

      if (anomalyResult.flag) {
        anomalyFlag = anomalyResult.flag;
        anomalyReasons.push(...anomalyResult.reasons);
        
        if (anomalyResult.suggestions.length > 0) {
          warnings.push(...anomalyResult.suggestions);
        }
      }

      // Additional check against historical patterns
      const normalCheck = await consumptionService.isConsumptionNormal(
        reading.customerId,
        consumption
      );

      if (!normalCheck.isNormal && normalCheck.reason) {
        if (!anomalyFlag) {
          // Only set if not already flagged by rules
          anomalyFlag = consumption < (normalCheck.expectedRange?.min ?? 0) ? 'low' : 'high';
        }
        anomalyReasons.push(normalCheck.reason);
      }
    }

    // Prepare the database insert
    const dbReading: DbReadingInsert = {
      tenant_id: tenantId,
      customer_id: reading.customerId,
      reading_value: reading.readingValue,
      reading_date: reading.readingDate,
      previous_reading_value: previousReading?.reading_value ?? null,
      consumption: consumption,
      anomaly_flag: anomalyFlag,
      photo_path: reading.photoUrl ?? null,
      metadata: {
        ...reading.metadata,
        photoId: reading.photoId,
        anomalyReasons: anomalyReasons.length > 0 ? anomalyReasons : undefined,
        processingWarnings: warnings.length > 0 ? warnings : undefined,
      },
      source: options.source || 'manual',
    };

    return {
      reading: dbReading,
      previousReading,
      consumption,
      anomalyFlag,
      anomalyReasons,
      warnings,
    };
  }

  /**
   * Process multiple readings in batch
   */
  async processBatch(
    tenantId: string,
    readings: CreateReading[],
    options: ProcessingOptions = {}
  ): Promise<ProcessedReading[]> {
    // Sort readings by date to ensure proper consumption calculation
    const sortedReadings = [...readings].sort((a, b) => 
      new Date(a.readingDate).getTime() - new Date(b.readingDate).getTime()
    );

    const results: ProcessedReading[] = [];
    const processedByCustomer = new Map<string, ProcessedReading>();

    for (const reading of sortedReadings) {
      // Process reading
      const processed = await this.processReading(tenantId, reading, options);
      
      // Update the map so subsequent readings use this as previous
      const previousForCustomer = processedByCustomer.get(reading.customerId);
      if (previousForCustomer) {
        // Recalculate consumption based on the just-processed reading
        const consumption = consumptionService.calculateConsumption(
          reading.readingValue,
          previousForCustomer.reading.reading_value
        );
        
        processed.reading.previous_reading_value = previousForCustomer.reading.reading_value;
        processed.reading.consumption = consumption;
        processed.consumption = consumption;
      }

      processedByCustomer.set(reading.customerId, processed);
      results.push(processed);
    }

    return results;
  }

  /**
   * Validate a reading before processing
   */
  validateReading(reading: CreateReading): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check reading value
    if (reading.readingValue < 0) {
      errors.push('Reading value cannot be negative');
    }

    if (reading.readingValue > 999999999.999) {
      errors.push('Reading value exceeds maximum allowed');
    }

    // Check reading date
    const readingDate = new Date(reading.readingDate);
    const now = new Date();
    const oneYearFromNow = new Date(now);
    oneYearFromNow.setFullYear(now.getFullYear() + 1);

    if (readingDate > oneYearFromNow) {
      errors.push('Reading date cannot be more than 1 year in the future');
    }

    const tenYearsAgo = new Date(now);
    tenYearsAgo.setFullYear(now.getFullYear() - 10);

    if (readingDate < tenYearsAgo) {
      errors.push('Reading date cannot be more than 10 years in the past');
    }

    // Validate metadata if present
    if (reading.metadata) {
      if (reading.metadata.location) {
        const { latitude, longitude, accuracy } = reading.metadata.location;
        
        if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
          errors.push('Invalid latitude value');
        }
        
        if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
          errors.push('Invalid longitude value');
        }
        
        if (accuracy !== undefined && accuracy <= 0) {
          errors.push('Location accuracy must be positive');
        }
      }

      if (reading.metadata.notes && reading.metadata.notes.length > 500) {
        errors.push('Notes cannot exceed 500 characters');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Calculate estimated reading for a date
   */
  async estimateReading(
    customerId: string,
    targetDate: Date
  ): Promise<{
    estimatedValue: number;
    estimatedConsumption: number;
    confidence: 'high' | 'medium' | 'low';
    basedOnReadings: number;
  } | null> {
    return consumptionService.estimateNextReading(customerId, targetDate);
  }

  /**
   * Get consumption statistics for a customer
   */
  async getConsumptionStats(
    customerId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalConsumption: number;
    averageConsumption: number;
    minConsumption: number;
    maxConsumption: number;
    readingCount: number;
    anomalyCount: {
      negative: number;
      low: number;
      high: number;
    };
  } | null> {
    const history = await consumptionService.getConsumptionHistory(customerId, 100);
    
    if (history.length === 0) {
      return null;
    }

    // Filter by date range if provided
    let filteredHistory = history;
    if (startDate || endDate) {
      filteredHistory = history.filter(r => {
        const readingDate = new Date(r.reading_date);
        if (startDate && readingDate < startDate) return false;
        if (endDate && readingDate > endDate) return false;
        return true;
      });
    }

    if (filteredHistory.length === 0) {
      return null;
    }

    const consumptions = filteredHistory
      .map(r => r.consumption)
      .filter((c): c is number => c !== null && c >= 0);

    const anomalyCounts = filteredHistory.reduce(
      (acc, r) => {
        if (r.anomaly_flag === 'negative') acc.negative++;
        else if (r.anomaly_flag === 'low') acc.low++;
        else if (r.anomaly_flag === 'high') acc.high++;
        return acc;
      },
      { negative: 0, low: 0, high: 0 }
    );

    if (consumptions.length === 0) {
      return {
        totalConsumption: 0,
        averageConsumption: 0,
        minConsumption: 0,
        maxConsumption: 0,
        readingCount: filteredHistory.length,
        anomalyCount: anomalyCounts,
      };
    }

    return {
      totalConsumption: consumptions.reduce((a, b) => a + b, 0),
      averageConsumption: consumptions.reduce((a, b) => a + b, 0) / consumptions.length,
      minConsumption: Math.min(...consumptions),
      maxConsumption: Math.max(...consumptions),
      readingCount: filteredHistory.length,
      anomalyCount: anomalyCounts,
    };
  }
}

// Export singleton instance
export const readingProcessor = new ReadingProcessor();