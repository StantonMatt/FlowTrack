import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withIdempotency } from '@/lib/middleware/idempotency';
import { ConsumptionCalculator } from '@/lib/readings/consumption-calculator';
import { AnomalyRulesEngine } from '@/lib/readings/anomaly-rules-engine';
import { realtimeEmitter } from '@/lib/realtime/events';
import { z } from 'zod';

// Bulk reading schema
const bulkReadingSchema = z.object({
  items: z.array(z.object({
    customerId: z.string().uuid(),
    reading: z.number().positive(),
    readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    metadata: z.object({
      readBy: z.string().optional(),
      method: z.enum(['manual', 'automated', 'estimated']).optional(),
      location: z.string().optional(),
    }).optional(),
    photoPath: z.string().optional(),
  })).min(1).max(1000), // Enforce payload limits
});

interface ProcessedReading {
  index: number;
  ok: boolean;
  id?: string;
  error?: string;
  warnings?: string[];
  consumption?: number | null;
  anomalyFlag?: boolean;
  anomalyScore?: number;
}

export async function POST(request: NextRequest) {
  return withIdempotency(request, async (req) => {
    try {
      const supabase = await createClient();
      
      // Check authentication
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const tenantId = user.user_metadata?.tenant_id;
      if (!tenantId) {
        return NextResponse.json({ error: 'No tenant associated' }, { status: 403 });
      }

      // Add tenant ID for idempotency
      req.headers.set('X-Tenant-Id', tenantId);

      // Check user role - must have appropriate permissions
      const { data: userRole } = await supabase
        .from('user_tenant_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .single();

      const allowedRoles = ['admin', 'manager', 'office_clerk'];
      if (!userRole || !allowedRoles.includes(userRole.role)) {
        return NextResponse.json(
          { error: 'Insufficient permissions for bulk operations' },
          { status: 403 }
        );
      }

      // Parse and validate request body
      const body = await req.json();
      const validatedData = bulkReadingSchema.parse(body);
      
      // Initialize services
      const calculator = new ConsumptionCalculator();
      const rulesEngine = new AnomalyRulesEngine();
      
      // Process in configurable batch sizes for transactions
      const BATCH_SIZE = 50;
      const results: ProcessedReading[] = [];
      const successfulReadings: any[] = [];
      
      for (let i = 0; i < validatedData.items.length; i += BATCH_SIZE) {
        const batch = validatedData.items.slice(i, i + BATCH_SIZE);
        
        // Process batch in transaction
        const batchResults = await supabase.rpc('process_bulk_readings_transaction', {
          p_tenant_id: tenantId,
          p_user_id: user.id,
          p_readings: JSON.stringify(batch),
        });

        if (batchResults.error) {
          // If RPC doesn't exist, fall back to manual processing
          const manualResults = await processBatchManually(
            batch,
            i,
            tenantId,
            user.id,
            supabase,
            calculator,
            rulesEngine
          );
          results.push(...manualResults.results);
          successfulReadings.push(...manualResults.successful);
        } else {
          // Parse RPC results
          const rpcData = batchResults.data as any[];
          rpcData.forEach((item, idx) => {
            results.push({
              index: i + idx,
              ok: item.success,
              id: item.reading_id,
              error: item.error_message,
              consumption: item.consumption,
              anomalyFlag: item.anomaly_flag,
            });
            
            if (item.success) {
              successfulReadings.push(item);
            }
          });
        }
      }

      // Emit realtime events for successful inserts
      for (const reading of successfulReadings) {
        try {
          await realtimeEmitter.emitReadingInsert(
            tenantId,
            {
              readingId: reading.id || reading.reading_id,
              customerId: reading.customer_id,
              readingValue: reading.reading_value,
              readingDate: reading.reading_date,
              consumption: reading.consumption,
              anomalyFlag: reading.anomaly_flag,
              anomalyReasons: reading.anomaly_reasons || [],
            },
            user.id
          );
        } catch (error) {
          console.error('Failed to emit realtime event:', error);
        }
      }

      // Audit log for bulk operation
      await supabase
        .from('audit_logs')
        .insert({
          tenant_id: tenantId,
          user_id: user.id,
          action: 'reading.bulk_create',
          resource_type: 'meter_reading',
          details: {
            total_items: validatedData.items.length,
            successful: results.filter(r => r.ok).length,
            failed: results.filter(r => !r.ok).length,
            batch_size: BATCH_SIZE,
          },
        });

      // Build response
      const successCount = results.filter(r => r.ok).length;
      const failureCount = results.filter(r => !r.ok).length;

      return NextResponse.json({
        success: failureCount === 0,
        totalItems: validatedData.items.length,
        successCount,
        failureCount,
        results,
        summary: {
          processedInBatches: Math.ceil(validatedData.items.length / BATCH_SIZE),
          batchSize: BATCH_SIZE,
          anomaliesDetected: results.filter(r => r.anomalyFlag).length,
        },
      }, { status: failureCount === 0 ? 201 : 207 }); // 207 Multi-Status for partial success
    } catch (error) {
      console.error('Bulk API error:', error);
      
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', errors: error.errors },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// Manual batch processing fallback
async function processBatchManually(
  batch: any[],
  startIndex: number,
  tenantId: string,
  userId: string,
  supabase: any,
  calculator: ConsumptionCalculator,
  rulesEngine: AnomalyRulesEngine
): Promise<{ results: ProcessedReading[], successful: any[] }> {
  const results: ProcessedReading[] = [];
  const successful: any[] = [];

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const index = startIndex + i;

    try {
      // Calculate consumption
      const consumptionResult = await calculator.calculateConsumption(
        tenantId,
        item.customerId,
        item.reading,
        item.readingDate
      );

      // Check anomaly rules
      const anomalyCheck = await rulesEngine.checkReading(
        tenantId,
        item.customerId,
        item.reading,
        item.readingDate,
        consumptionResult.previous_value,
        consumptionResult.previous_date,
        consumptionResult.consumption
      );

      // Prepare reading data
      const readingData = {
        tenant_id: tenantId,
        customer_id: item.customerId,
        reading_value: item.reading,
        reading_date: item.readingDate,
        previous_reading_value: consumptionResult.previous_value,
        consumption: consumptionResult.consumption,
        anomaly_flag: !anomalyCheck.passed,
        anomaly_details: anomalyCheck.triggered_rules.length > 0 ? anomalyCheck.triggered_rules : null,
        metadata: {
          ...item.metadata,
          source: 'bulk',
          anomaly_score: anomalyCheck.anomaly_score,
        },
        photo_path: item.photoPath,
        created_by: userId,
      };

      // Insert reading
      const { data: reading, error: insertError } = await supabase
        .from('meter_readings')
        .insert(readingData)
        .select()
        .single();

      if (insertError) {
        results.push({
          index,
          ok: false,
          error: insertError.message,
        });
      } else {
        results.push({
          index,
          ok: true,
          id: reading.id,
          consumption: consumptionResult.consumption,
          anomalyFlag: !anomalyCheck.passed,
          anomalyScore: anomalyCheck.anomaly_score,
        });
        successful.push({
          ...reading,
          anomaly_reasons: anomalyCheck.triggered_rules.map(r => r.message),
        });
      }
    } catch (error) {
      results.push({
        index,
        ok: false,
        error: error instanceof Error ? error.message : 'Processing failed',
      });
    }
  }

  return { results, successful };
}