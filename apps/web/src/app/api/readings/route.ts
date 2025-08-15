import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readingProcessor } from '@/lib/readings/reading-processor';
// import { createReadingSchema, readingFiltersSchema } from '@flowtrack/shared/schemas/reading';
// TODO: Define these schemas locally for now until shared package is fully set up
import { withIdempotency } from '@/lib/middleware/idempotency';
import { ConsumptionCalculator } from '@/lib/readings/consumption-calculator';
import { AnomalyRulesEngine } from '@/lib/readings/anomaly-rules-engine';
import { realtimeEmitter } from '@/lib/realtime/events';
import { z } from 'zod';

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

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const filters = readingFiltersSchema.parse({
      customerId: searchParams.get('customerId'),
      dateFrom: searchParams.get('dateFrom'),
      dateTo: searchParams.get('dateTo'),
      anomalyFlag: searchParams.get('anomalyFlag'),
      hasPhoto: searchParams.get('hasPhoto') === 'true' ? true : 
                searchParams.get('hasPhoto') === 'false' ? false : undefined,
      source: searchParams.get('source'),
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      sortBy: searchParams.get('sortBy'),
      sortOrder: searchParams.get('sortOrder'),
    });

    // Build query
    let query = supabase
      .from('meter_readings')
      .select(`
        *,
        customers!inner(
          id,
          account_number,
          full_name,
          billing_address
        )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId);

    // Apply filters
    if (filters.customerId) {
      query = query.eq('customer_id', filters.customerId);
    }
    if (filters.dateFrom) {
      query = query.gte('reading_date', filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte('reading_date', filters.dateTo);
    }
    if (filters.anomalyFlag) {
      query = query.eq('anomaly_flag', filters.anomalyFlag);
    }
    if (filters.hasPhoto === true) {
      query = query.not('photo_path', 'is', null);
    } else if (filters.hasPhoto === false) {
      query = query.is('photo_path', null);
    }
    if (filters.source) {
      query = query.eq('source', filters.source);
    }

    // Apply sorting
    const sortColumn = filters.sortBy === 'readingDate' ? 'reading_date' :
                      filters.sortBy === 'createdAt' ? 'created_at' :
                      'consumption';
    query = query.order(sortColumn, { ascending: filters.sortOrder === 'asc' });

    // Apply pagination
    const offset = (filters.page - 1) * filters.limit;
    query = query.range(offset, offset + filters.limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching readings:', error);
      return NextResponse.json({ error: 'Failed to fetch readings' }, { status: 500 });
    }

    return NextResponse.json({
      data: data || [],
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / filters.limit),
      },
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
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

    // Add tenant ID to headers for idempotency middleware
    req.headers.set('X-Tenant-Id', tenantId);

    // Parse and validate request body
    const body = await req.json();
    
    // Enhanced validation schema for single reading
    const singleReadingSchema = z.object({
      customerId: z.string().uuid(),
      reading: z.number().positive(),
      readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      metadata: z.object({
        readBy: z.string().optional(),
        method: z.enum(['manual', 'automated', 'estimated']).optional(),
        location: z.string().optional(),
      }).optional(),
      photoPath: z.string().optional(),
    });
    
    const validatedData = singleReadingSchema.parse(body);
    
    // Calculate consumption
    const calculator = new ConsumptionCalculator();
    const consumptionResult = await calculator.calculateConsumption(
      tenantId,
      validatedData.customerId,
      validatedData.reading,
      validatedData.readingDate
    );
    
    if (consumptionResult.error) {
      return NextResponse.json(
        { error: 'Failed to calculate consumption', details: consumptionResult.error },
        { status: 500 }
      );
    }
    
    // Validate non-negative reading
    if (validatedData.reading < 0) {
      return NextResponse.json(
        { error: 'Reading value cannot be negative' },
        { status: 400 }
      );
    }
    
    // Evaluate anomaly rules
    const rulesEngine = new AnomalyRulesEngine();
    const anomalyCheck = await rulesEngine.checkReading(
      tenantId,
      validatedData.customerId,
      validatedData.reading,
      validatedData.readingDate,
      consumptionResult.previous_value,
      consumptionResult.previous_date,
      consumptionResult.consumption
    );

    // Prepare reading data with all computed fields
    const readingData = {
      tenant_id: tenantId,
      customer_id: validatedData.customerId,
      reading_value: validatedData.reading,
      reading_date: validatedData.readingDate,
      previous_reading_value: consumptionResult.previous_value,
      consumption: consumptionResult.consumption,
      anomaly_flag: !anomalyCheck.passed,
      anomaly_details: anomalyCheck.triggered_rules.length > 0 ? anomalyCheck.triggered_rules : null,
      metadata: {
        ...validatedData.metadata,
        source: 'single',
        anomaly_score: anomalyCheck.anomaly_score,
        anomaly_reasons: anomalyCheck.triggered_rules.map(r => r.message),
      },
      photo_path: validatedData.photoPath,
      created_by: user.id,
      created_at: new Date().toISOString(),
    };
    
    // Insert the reading
    const { data: reading, error: insertError } = await supabase
      .from('meter_readings')
      .insert(readingData)
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting reading:', insertError);
      return NextResponse.json(
        { error: 'Failed to create reading' },
        { status: 500 }
      );
    }

    // Upload photo if provided
    if (validatedData.photoId && body.photoData) {
      try {
        const photoPath = `${tenantId}/${reading.id}/${validatedData.photoId}.jpg`;
        const photoData = body.photoData.replace(/^data:image\/\w+;base64,/, '');
        const photoBuffer = Buffer.from(photoData, 'base64');

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
        console.error('Error uploading photo:', photoError);
        // Don't fail the request if photo upload fails
      }
    }

    // Emit realtime event
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
          anomalyReasons: anomalyCheck.triggered_rules.map(r => r.message),
        },
        user.id
      );
      
      // Emit anomaly event if detected
      if (!anomalyCheck.passed && anomalyCheck.triggered_rules.length > 0) {
        const mostSevere = anomalyCheck.triggered_rules.reduce((prev, curr) => 
          curr.severity === 'critical' ? curr : prev
        );
        
        await realtimeEmitter.emitAnomalyDetected(
          tenantId,
          {
            readingId: reading.id,
            customerId: reading.customer_id,
            anomalyType: mostSevere.rule_type,
            severity: mostSevere.severity,
            details: {
              rules: anomalyCheck.triggered_rules,
              score: anomalyCheck.anomaly_score,
            },
          },
          user.id
        );
      }
    } catch (realtimeError) {
      console.error('Failed to emit realtime event:', realtimeError);
      // Don't fail the request if realtime fails
    }
    
    // Audit log
    await supabase
      .from('audit_logs')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        action: 'reading.create',
        resource_type: 'meter_reading',
        resource_id: reading.id,
        details: {
          customer_id: reading.customer_id,
          reading_value: reading.reading_value,
          consumption: reading.consumption,
          anomaly_detected: reading.anomaly_flag,
        },
      });
    
    const response = {
      id: reading.id,
      ...reading,
      consumption: consumptionResult,
      anomalyCheck: {
        passed: anomalyCheck.passed,
        score: anomalyCheck.anomaly_score,
        triggeredRules: anomalyCheck.triggered_rules,
      },
    };

    // Response will be cached by withIdempotency wrapper if idempotency key was provided
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('API error:', error);
    
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