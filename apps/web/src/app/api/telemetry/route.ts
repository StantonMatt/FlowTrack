import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

// Telemetry event schema
const telemetryEventSchema = z.object({
  type: z.enum([
    'sync_telemetry',
    'sync_queue_metrics',
    'pwa_performance',
    'error_report',
    'user_analytics',
  ]),
  data: z.record(z.any()),
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
});

/**
 * POST /api/telemetry
 * Endpoint for collecting telemetry data
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Parse and validate request body
    const body = await request.json();
    const validatedData = telemetryEventSchema.parse(body);
    
    // Get auth context if available
    const { data: { user } } = await supabase.auth.getUser();
    
    // Enrich telemetry with server-side data
    const telemetryData = {
      ...validatedData,
      timestamp: validatedData.timestamp || new Date().toISOString(),
      userId: validatedData.userId || user?.id,
      metadata: {
        userAgent: request.headers.get('user-agent'),
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        referer: request.headers.get('referer'),
      },
    };
    
    // Store telemetry based on type
    switch (validatedData.type) {
      case 'sync_telemetry':
        await storeSyncTelemetry(supabase, telemetryData);
        break;
      
      case 'sync_queue_metrics':
        await storeSyncQueueMetrics(supabase, telemetryData);
        break;
      
      case 'pwa_performance':
        await storePWAPerformance(supabase, telemetryData);
        break;
      
      case 'error_report':
        await storeErrorReport(supabase, telemetryData);
        break;
      
      case 'user_analytics':
        await storeUserAnalytics(supabase, telemetryData);
        break;
    }
    
    // Log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[Telemetry]', validatedData.type, validatedData.data);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Telemetry error:', error);
    
    // Don't return errors to client - telemetry should be fire-and-forget
    return NextResponse.json({ success: true });
  }
}

/**
 * Store sync telemetry data
 */
async function storeSyncTelemetry(supabase: any, data: any) {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) return;
  
  const tenantId = session.session.user.user_metadata?.tenant_id;
  if (!tenantId) return;
  
  // Create telemetry table if not exists (would normally be in migration)
  const { error: tableError } = await supabase.rpc('create_telemetry_table_if_not_exists');
  
  // Insert telemetry record
  const { error } = await supabase
    .from('sync_telemetry')
    .insert({
      tenant_id: tenantId,
      user_id: data.userId,
      event_type: 'sync',
      event_data: data.data,
      timestamp: data.timestamp,
      metadata: data.metadata,
    });
  
  if (error) {
    console.error('Failed to store sync telemetry:', error);
  }
}

/**
 * Store sync queue metrics
 */
async function storeSyncQueueMetrics(supabase: any, data: any) {
  // Store in a metrics table or send to monitoring service
  const metrics = data.data;
  
  // Could send to external monitoring service like DataDog, New Relic, etc.
  if (process.env.MONITORING_ENDPOINT) {
    try {
      await fetch(process.env.MONITORING_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.MONITORING_API_KEY || '',
        },
        body: JSON.stringify({
          metric: 'sync_queue',
          value: metrics,
          timestamp: data.timestamp,
        }),
      });
    } catch (error) {
      console.error('Failed to send metrics to monitoring service:', error);
    }
  }
}

/**
 * Store PWA performance metrics
 */
async function storePWAPerformance(supabase: any, data: any) {
  // Performance metrics like load times, cache hit rates, etc.
  const performance = data.data;
  
  // Log performance metrics
  console.log('[PWA Performance]', {
    timestamp: data.timestamp,
    ...performance,
  });
  
  // Could aggregate and store periodically
}

/**
 * Store error reports
 */
async function storeErrorReport(supabase: any, data: any) {
  const { data: session } = await supabase.auth.getSession();
  const tenantId = session?.session?.user.user_metadata?.tenant_id;
  
  // Store critical errors for debugging
  if (data.data.severity === 'critical' || data.data.severity === 'error') {
    const { error } = await supabase
      .from('error_logs')
      .insert({
        tenant_id: tenantId,
        user_id: data.userId,
        error_type: data.data.type,
        error_message: data.data.message,
        error_stack: data.data.stack,
        context: data.data.context,
        timestamp: data.timestamp,
        metadata: data.metadata,
      });
    
    if (error) {
      console.error('Failed to store error report:', error);
    }
  }
}

/**
 * Store user analytics
 */
async function storeUserAnalytics(supabase: any, data: any) {
  // User behavior analytics
  const analytics = data.data;
  
  // Could send to analytics service like Mixpanel, Amplitude, etc.
  if (process.env.ANALYTICS_ENDPOINT) {
    try {
      await fetch(process.env.ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.ANALYTICS_API_KEY || '',
        },
        body: JSON.stringify({
          event: analytics.event,
          properties: analytics.properties,
          userId: data.userId,
          timestamp: data.timestamp,
        }),
      });
    } catch (error) {
      console.error('Failed to send analytics:', error);
    }
  }
}

/**
 * GET /api/telemetry
 * Endpoint for retrieving telemetry data (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check admin permission
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const tenantId = user.user_metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }
    
    // Check if user is admin
    const { data: role } = await supabase
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .single();
    
    if (role?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'sync_telemetry';
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    
    // Fetch telemetry data
    const { data: telemetryData, error } = await supabase
      .from('sync_telemetry')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) {
      console.error('Failed to fetch telemetry:', error);
      return NextResponse.json({ error: 'Failed to fetch telemetry' }, { status: 500 });
    }
    
    // Calculate aggregates
    const aggregates = calculateAggregates(telemetryData || []);
    
    return NextResponse.json({
      data: telemetryData,
      aggregates,
      pagination: {
        limit,
        offset,
        total: telemetryData?.length || 0,
      },
    });
  } catch (error) {
    console.error('Telemetry GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Calculate aggregate metrics from telemetry data
 */
function calculateAggregates(data: any[]) {
  if (data.length === 0) {
    return {
      totalSyncs: 0,
      averageDuration: 0,
      successRate: 0,
      totalItemsSynced: 0,
      totalPhotosSynced: 0,
    };
  }
  
  const syncs = data.filter(d => d.event_data?.totalItems > 0);
  const totalDuration = syncs.reduce((sum, d) => sum + (d.event_data?.duration || 0), 0);
  const totalSuccess = syncs.reduce((sum, d) => sum + (d.event_data?.successCount || 0), 0);
  const totalItems = syncs.reduce((sum, d) => sum + (d.event_data?.totalItems || 0), 0);
  const totalPhotos = syncs.reduce((sum, d) => sum + (d.event_data?.photoUploads || 0), 0);
  
  return {
    totalSyncs: syncs.length,
    averageDuration: syncs.length > 0 ? totalDuration / syncs.length : 0,
    successRate: totalItems > 0 ? (totalSuccess / totalItems) * 100 : 0,
    totalItemsSynced: totalSuccess,
    totalPhotosSynced: totalPhotos,
  };
}