import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readingProcessor } from '@/lib/readings/reading-processor';
import { createReadingSchema } from '@shared/schemas/reading';
import { z } from 'zod';

interface RouteParams {
  params: {
    id: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    // Fetch the reading
    const { data: reading, error } = await supabase
      .from('meter_readings')
      .select(`
        *,
        customers!inner(
          id,
          account_number,
          full_name,
          billing_address,
          service_address,
          meter_number,
          meter_type
        )
      `)
      .eq('id', params.id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !reading) {
      return NextResponse.json({ error: 'Reading not found' }, { status: 404 });
    }

    // Get consumption data
    const consumptionData = await readingProcessor.getConsumptionStats(
      reading.customer_id,
      new Date(new Date(reading.reading_date).setMonth(new Date(reading.reading_date).getMonth() - 12)),
      new Date(reading.reading_date)
    );

    // Get photo URL if exists
    let photoUrl = null;
    if (reading.photo_path) {
      const { data: urlData } = supabase.storage
        .from('reading-photos')
        .getPublicUrl(reading.photo_path);
      
      photoUrl = urlData?.publicUrl;
    }

    return NextResponse.json({
      ...reading,
      photoUrl,
      consumptionStats: consumptionData,
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

    // Check if reading exists and belongs to tenant
    const { data: existingReading, error: fetchError } = await supabase
      .from('meter_readings')
      .select('*')
      .eq('id', params.id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !existingReading) {
      return NextResponse.json({ error: 'Reading not found' }, { status: 404 });
    }

    // Parse request body
    const body = await request.json();
    
    // Only allow updating certain fields
    const allowedUpdates = ['reading_value', 'reading_date', 'metadata', 'anomaly_flag'];
    const updates: any = {};
    
    for (const field of allowedUpdates) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    // If reading value or date changed, recalculate consumption
    if ('reading_value' in updates || 'reading_date' in updates) {
      const newReadingValue = updates.reading_value ?? existingReading.reading_value;
      const newReadingDate = updates.reading_date ?? existingReading.reading_date;
      
      // Reprocess the reading
      const processed = await readingProcessor.processReading(
        tenantId,
        {
          customerId: existingReading.customer_id,
          readingValue: newReadingValue,
          readingDate: newReadingDate,
          metadata: updates.metadata || existingReading.metadata,
        },
        { 
          source: existingReading.source as any,
          skipAnomalyCheck: !('reading_value' in updates), // Only recheck anomaly if value changed
        }
      );

      updates.previous_reading_value = processed.reading.previous_reading_value;
      updates.consumption = processed.reading.consumption;
      
      if ('reading_value' in updates) {
        updates.anomaly_flag = processed.reading.anomaly_flag;
        
        // Add anomaly reasons to metadata
        if (processed.anomalyReasons.length > 0) {
          updates.metadata = {
            ...(updates.metadata || existingReading.metadata || {}),
            anomalyReasons: processed.anomalyReasons,
            lastRecalculated: new Date().toISOString(),
          };
        }
      }
    }

    // Update the reading
    const { data: updatedReading, error: updateError } = await supabase
      .from('meter_readings')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating reading:', updateError);
      return NextResponse.json(
        { error: 'Failed to update reading' },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedReading);
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
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    // Check user role - only admins can delete readings
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .single();

    if (!userRoles || userRoles.role !== 'admin') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Check if reading exists
    const { data: existingReading, error: fetchError } = await supabase
      .from('meter_readings')
      .select('photo_path')
      .eq('id', params.id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !existingReading) {
      return NextResponse.json({ error: 'Reading not found' }, { status: 404 });
    }

    // Delete associated photo if exists
    if (existingReading.photo_path) {
      await supabase.storage
        .from('reading-photos')
        .remove([existingReading.photo_path]);
    }

    // Delete the reading
    const { error: deleteError } = await supabase
      .from('meter_readings')
      .delete()
      .eq('id', params.id);

    if (deleteError) {
      console.error('Error deleting reading:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete reading' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}