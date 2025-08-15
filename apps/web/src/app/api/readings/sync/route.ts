import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withIdempotency } from '@/lib/middleware/idempotency';
import { ConsumptionCalculator } from '@/lib/readings/consumption-calculator';
import { AnomalyRulesEngine } from '@/lib/readings/anomaly-rules-engine';
import { realtimeEmitter } from '@/lib/realtime/events';
import { z } from 'zod';

// Enhanced sync payload schema
const syncReadingSchema = z.object({
  clientBatchId: z.string(),
  items: z.array(z.object({
    clientId: z.string(), // Client-side generated ID for mapping
    customerId: z.string().uuid(),
    readingValue: z.number().positive(), 
    readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    metadata: z.object({
      readBy: z.string().optional(),
      method: z.enum(['manual', 'automated', 'estimated']).optional(),
      location: z.string().optional(),
      offlineTimestamp: z.string().optional(), // When it was captured offline
      syncAttempts: z.number().optional(), // Number of sync attempts
    }).optional(),
    photoData: z.string().optional(), // Base64 photo data to upload
  })).min(1).max(100), // Reasonable limits for sync batch
});

interface SyncResult {
  clientBatchId: string;
  success: boolean;
  totalItems: number;
  successCount: number;
  failureCount: number;
  duplicateCount: number;
  results: Array<{
    clientId: string;
    ok: boolean;
    serverId?: string;
    error?: string;
    warnings?: string[];
    isDuplicate?: boolean;
  }>;
  summary?: {
    processedAt: string;
    idempotencyKey: string;
    anomaliesDetected: number;
  };
}

export async function POST(request: NextRequest) {
  // Require idempotency key for sync operations
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: 'Idempotency-Key header is required for sync operations' },
      { status: 400 }
    );
  }

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

      // Add tenant ID for idempotency context
      req.headers.set('X-Tenant-Id', tenantId);

      // Parse and validate request body
      const body = await req.json();
      const validatedData = syncReadingSchema.parse(body);

      
      // Initialize services
      const calculator = new ConsumptionCalculator();
      const rulesEngine = new AnomalyRulesEngine();
      
      // Process each item
      const results: SyncResult['results'] = [];
      const successfulReadings: any[] = [];
      
      // Check for duplicates based on customer + date within this batch
      const batchDuplicateCheck = new Map<string, string>();
      
      for (const item of validatedData.items) {
        const duplicateKey = `${item.customerId}:${item.readingDate}`;
        
        // Check for duplicate within batch
        if (batchDuplicateCheck.has(duplicateKey)) {
          results.push({
            clientId: item.clientId,
            ok: false,
            error: 'Duplicate reading in batch',
            isDuplicate: true,
          });
          continue;
        }
        batchDuplicateCheck.set(duplicateKey, item.clientId);

        try {
          // Check if reading already exists (handles offline retries)
          const { data: existingReading } = await supabase
            .from('meter_readings')
            .select('id, reading_value, consumption, anomaly_flag')
            .eq('tenant_id', tenantId)
            .eq('customer_id', item.customerId)
            .eq('reading_date', item.readingDate)
            .single();

          if (existingReading) {
            // Reading already exists - return success with existing ID
            // This handles offline retries gracefully
            results.push({
              clientId: item.clientId,
              ok: true,
              serverId: existingReading.id,
              isDuplicate: true,
              warnings: ['Reading already exists - returning existing record'],
            });
            continue;
          }

          // Calculate consumption
          const consumptionResult = await calculator.calculateConsumption(
            tenantId,
            item.customerId,
            item.readingValue,
            item.readingDate
          );

          if (consumptionResult.error) {
            results.push({
              clientId: item.clientId,
              ok: false,
              error: `Consumption calculation failed: ${consumptionResult.error}`,
            });
            continue;
          }

          // Check anomaly rules
          const anomalyCheck = await rulesEngine.checkReading(
            tenantId,
            item.customerId,
            item.readingValue,
            item.readingDate,
            consumptionResult.previous_value,
            consumptionResult.previous_date,
            consumptionResult.consumption
          );

          // Prepare reading data
          const readingData = {
            tenant_id: tenantId,
            customer_id: item.customerId,
            reading_value: item.readingValue,
            reading_date: item.readingDate,
            previous_reading_value: consumptionResult.previous_value,
            consumption: consumptionResult.consumption,
            anomaly_flag: !anomalyCheck.passed,
            anomaly_details: anomalyCheck.triggered_rules.length > 0 ? anomalyCheck.triggered_rules : null,
            metadata: {
              ...item.metadata,
              source: 'sync',
              clientBatchId: validatedData.clientBatchId,
              clientId: item.clientId,
              syncedAt: new Date().toISOString(),
              anomaly_score: anomalyCheck.anomaly_score,
            },
            created_by: user.id,
            created_at: new Date().toISOString(),
          };

          // Insert reading
          const { data: reading, error: insertError } = await supabase
            .from('meter_readings')
            .insert(readingData)
            .select()
            .single();

          if (insertError) {
            // Handle unique constraint violation
            if (insertError.code === '23505') {
              // Try to fetch the existing reading
              const { data: conflictReading } = await supabase
                .from('meter_readings')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('customer_id', item.customerId)
                .eq('reading_date', item.readingDate)
                .single();

              if (conflictReading) {
                results.push({
                  clientId: item.clientId,
                  ok: true,
                  serverId: conflictReading.id,
                  isDuplicate: true,
                  warnings: ['Concurrent insert detected - returning existing record'],
                });
                continue;
              }
            }

            results.push({
              clientId: item.clientId,
              ok: false,
              error: insertError.message,
            });
          } else {
            // Upload photo if provided
            if (item.photoData && reading) {
              try {
                const photoPath = `${tenantId}/${reading.id}/photo.jpg`;
                const photoBuffer = Buffer.from(
                  item.photoData.replace(/^data:image\/\w+;base64,/, ''),
                  'base64'
                );

                const { error: uploadError } = await supabase.storage
                  .from('reading-photos')
                  .upload(photoPath, photoBuffer, {
                    contentType: 'image/jpeg',
                    upsert: false,
                  });

                if (!uploadError) {
                  // Update reading with photo path
                  await supabase
                    .from('meter_readings')
                    .update({ photo_path: photoPath })
                    .eq('id', reading.id);
                  
                  reading.photo_path = photoPath;
                }
              } catch (photoError) {
                console.error('Photo upload error:', photoError);
                // Don't fail the sync if photo upload fails
              }
            }

            results.push({
              clientId: item.clientId,
              ok: true,
              serverId: reading.id,
              warnings: anomalyCheck.triggered_rules.length > 0 
                ? anomalyCheck.triggered_rules.map(r => r.message)
                : undefined,
            });
            
            successfulReadings.push({
              ...reading,
              anomaly_reasons: anomalyCheck.triggered_rules.map(r => r.message),
            });
          }
        } catch (error) {
          results.push({
            clientId: item.clientId,
            ok: false,
            error: error instanceof Error ? error.message : 'Processing failed',
          });
        }
      }

      // Emit realtime events for successful inserts
      for (const reading of successfulReadings) {
        try {
          await realtimeEmitter.emitReadingInsert(
            tenantId,
            {
              readingId: reading.id,
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
          // Don't fail the sync if realtime fails
        }
      }

      // Create sync audit log
      await supabase
        .from('audit_logs')
        .insert({
          tenant_id: tenantId,
          user_id: user.id,
          action: 'reading.sync',
          resource_type: 'meter_reading',
          details: {
            client_batch_id: validatedData.clientBatchId,
            idempotency_key: idempotencyKey,
            total_items: validatedData.items.length,
            successful: results.filter(r => r.ok).length,
            failed: results.filter(r => !r.ok).length,
            duplicates: results.filter(r => r.isDuplicate).length,
          },
        });

      // Build response with client ID mapping
      const response: SyncResult = {
        clientBatchId: validatedData.clientBatchId,
        success: results.every(r => r.ok),
        totalItems: validatedData.items.length,
        successCount: results.filter(r => r.ok).length,
        failureCount: results.filter(r => !r.ok).length,
        duplicateCount: results.filter(r => r.isDuplicate).length,
        results,
        summary: {
          processedAt: new Date().toISOString(),
          idempotencyKey,
          anomaliesDetected: successfulReadings.filter(r => r.anomaly_flag).length,
        },
      };

      // Status 200 for successful sync (even with some failures)
      // Status 207 Multi-Status if partial success
      const status = results.every(r => r.ok) ? 200 : 207;
      
      return NextResponse.json(response, { status });
    } catch (error) {
      console.error('Sync API error:', error);
      
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { 
            error: 'Invalid sync data', 
            errors: error.errors,
            clientBatchId: request.headers.get('X-Client-Batch-Id'),
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { 
          error: error instanceof Error ? error.message : 'Sync failed',
          clientBatchId: request.headers.get('X-Client-Batch-Id'),
        },
        { status: 500 }
      );
    }
  }, {
    // Custom options for sync endpoint
    ttl: 7200, // 2 hours TTL for sync idempotency
    prefix: 'sync',
  });
}

// GET endpoint to check sync status
export async function GET(request: NextRequest) {
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

    // Get client batch ID from query params
    const clientBatchId = request.nextUrl.searchParams.get('batchId');
    
    if (!clientBatchId) {
      // Return list of recent sync operations
      const { data: recentSyncs } = await supabase
        .from('idempotency_keys')
        .select('key, created_at, response')
        .eq('tenant_id', tenantId)
        .like('key', 'sync-%')
        .order('created_at', { ascending: false })
        .limit(20);

      const syncs = recentSyncs?.map(sync => ({
        batchId: sync.key.replace('sync-', ''),
        syncedAt: sync.created_at,
        result: sync.response as SyncResult,
      })) || [];

      return NextResponse.json({ syncs });
    }

    // Check specific batch status
    const { data: syncRecord } = await supabase
      .from('idempotency_keys')
      .select('response, created_at')
      .eq('tenant_id', tenantId)
      .eq('key', `sync-${clientBatchId}`)
      .single();

    if (!syncRecord) {
      return NextResponse.json(
        { error: 'Sync batch not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      batchId: clientBatchId,
      syncedAt: syncRecord.created_at,
      result: syncRecord.response as SyncResult,
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// OPTIONS endpoint for CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, X-Client-Batch-Id, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}