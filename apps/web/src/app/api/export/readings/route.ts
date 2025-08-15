import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { exportToCSV } from '@/lib/import/csv-parser';
import { exportToExcel } from '@/lib/import/excel-parser';
import { format } from 'date-fns';

/**
 * GET /api/export/readings
 * Export meter readings to CSV or Excel
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = user.user_metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get('format') || 'csv';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const customerId = searchParams.get('customerId');
    const status = searchParams.get('status');
    const includePhotos = searchParams.get('includePhotos') === 'true';

    // Build query
    let query = supabase
      .from('meter_readings')
      .select(`
        id,
        customer_id,
        customers!inner (
          account_number,
          first_name,
          last_name,
          service_address,
          meter_number
        ),
        reading_date,
        reading_value,
        previous_reading_value,
        consumption,
        reading_type,
        anomaly_flag,
        approval_status,
        notes,
        photo_url,
        created_at,
        created_by
      `)
      .eq('tenant_id', tenantId)
      .order('reading_date', { ascending: false });

    // Apply filters
    if (startDate) {
      query = query.gte('reading_date', startDate);
    }
    if (endDate) {
      query = query.lte('reading_date', endDate);
    }
    if (customerId) {
      query = query.eq('customer_id', customerId);
    }
    if (status) {
      query = query.eq('approval_status', status);
    }

    const { data: readings, error } = await query;

    if (error) {
      console.error('Export query error:', error);
      return NextResponse.json({ error: 'Failed to fetch readings' }, { status: 500 });
    }

    // Transform data for export
    const exportData = readings?.map(reading => ({
      account_number: reading.customers.account_number,
      customer_name: `${reading.customers.first_name} ${reading.customers.last_name}`,
      meter_number: reading.customers.meter_number,
      service_address: reading.customers.service_address,
      reading_date: reading.reading_date,
      reading_value: reading.reading_value,
      previous_reading: reading.previous_reading_value || '',
      consumption: reading.consumption || '',
      reading_type: reading.reading_type,
      anomaly_flag: reading.anomaly_flag || '',
      approval_status: reading.approval_status,
      notes: reading.notes || '',
      photo_url: includePhotos ? reading.photo_url || '' : '',
      created_at: reading.created_at,
    })) || [];

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `meter_readings_${timestamp}`;

    // Export based on format
    if (format === 'excel' || format === 'xlsx') {
      // For Excel, we need to return the file differently
      // Create a blob and return it
      const { Blob } = await import('buffer');
      exportToExcel(exportData, `${filename}.xlsx`, 'Readings');
      
      return NextResponse.json({
        success: true,
        message: 'Export initiated',
        filename: `${filename}.xlsx`,
        count: exportData.length,
      });
    } else {
      // Generate CSV
      const csv = generateCSV(exportData);
      
      // Return CSV as response
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}.csv"`,
        },
      });
    }
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Export failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/export/readings
 * Export readings with advanced options
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = user.user_metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    const body = await request.json();
    const {
      format = 'csv',
      filters = {},
      columns = [],
      includeStats = false,
      groupBy = null,
    } = body;

    // Build complex query based on filters
    let query = supabase
      .from('meter_readings')
      .select(`
        *,
        customers!inner (*)
      `)
      .eq('tenant_id', tenantId);

    // Apply all filters
    if (filters.dateRange) {
      if (filters.dateRange.start) {
        query = query.gte('reading_date', filters.dateRange.start);
      }
      if (filters.dateRange.end) {
        query = query.lte('reading_date', filters.dateRange.end);
      }
    }

    if (filters.customerIds && filters.customerIds.length > 0) {
      query = query.in('customer_id', filters.customerIds);
    }

    if (filters.anomalyFlags && filters.anomalyFlags.length > 0) {
      query = query.in('anomaly_flag', filters.anomalyFlags);
    }

    if (filters.approvalStatus) {
      query = query.eq('approval_status', filters.approvalStatus);
    }

    if (filters.minConsumption !== undefined) {
      query = query.gte('consumption', filters.minConsumption);
    }

    if (filters.maxConsumption !== undefined) {
      query = query.lte('consumption', filters.maxConsumption);
    }

    const { data: readings, error } = await query;

    if (error) {
      console.error('Export query error:', error);
      return NextResponse.json({ error: 'Failed to fetch readings' }, { status: 500 });
    }

    // Process data based on options
    let exportData = readings || [];

    // Group data if requested
    if (groupBy === 'customer') {
      exportData = groupByCustomer(exportData);
    } else if (groupBy === 'month') {
      exportData = groupByMonth(exportData);
    }

    // Add statistics if requested
    if (includeStats) {
      exportData = addStatistics(exportData);
    }

    // Filter columns if specified
    if (columns.length > 0) {
      exportData = filterColumns(exportData, columns);
    }

    // Generate response based on format
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `meter_readings_export_${timestamp}`;

    if (format === 'json') {
      return NextResponse.json({
        data: exportData,
        metadata: {
          exportDate: new Date().toISOString(),
          recordCount: exportData.length,
          filters: filters,
        },
      });
    } else if (format === 'excel' || format === 'xlsx') {
      // Return info for client-side download
      return NextResponse.json({
        success: true,
        message: 'Export ready for download',
        filename: `${filename}.xlsx`,
        count: exportData.length,
        data: exportData, // Client will handle Excel generation
      });
    } else {
      // CSV format
      const csv = generateCSV(exportData);
      
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}.csv"`,
        },
      });
    }
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Export failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Generate CSV from data
 */
function generateCSV(data: any[]): string {
  if (data.length === 0) {
    return '';
  }

  // Get headers
  const headers = Object.keys(data[0]);
  
  // Create CSV lines
  const lines = [];
  lines.push(headers.join(','));
  
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      // Escape values containing commas or quotes
      if (value === null || value === undefined) {
        return '';
      }
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    });
    lines.push(values.join(','));
  }
  
  return lines.join('\n');
}

/**
 * Group data by customer
 */
function groupByCustomer(data: any[]): any[] {
  const grouped = new Map();
  
  for (const reading of data) {
    const customerId = reading.customer_id;
    if (!grouped.has(customerId)) {
      grouped.set(customerId, {
        customer_id: customerId,
        customer_name: `${reading.customers.first_name} ${reading.customers.last_name}`,
        account_number: reading.customers.account_number,
        readings: [],
        total_consumption: 0,
        reading_count: 0,
      });
    }
    
    const group = grouped.get(customerId);
    group.readings.push({
      date: reading.reading_date,
      value: reading.reading_value,
      consumption: reading.consumption,
    });
    group.total_consumption += reading.consumption || 0;
    group.reading_count++;
  }
  
  return Array.from(grouped.values());
}

/**
 * Group data by month
 */
function groupByMonth(data: any[]): any[] {
  const grouped = new Map();
  
  for (const reading of data) {
    const month = format(new Date(reading.reading_date), 'yyyy-MM');
    if (!grouped.has(month)) {
      grouped.set(month, {
        month,
        readings: [],
        total_consumption: 0,
        average_consumption: 0,
        reading_count: 0,
        customer_count: new Set(),
      });
    }
    
    const group = grouped.get(month);
    group.readings.push(reading);
    group.total_consumption += reading.consumption || 0;
    group.reading_count++;
    group.customer_count.add(reading.customer_id);
  }
  
  // Calculate averages
  for (const [month, group] of grouped) {
    group.average_consumption = group.total_consumption / group.reading_count;
    group.customer_count = group.customer_count.size;
  }
  
  return Array.from(grouped.values());
}

/**
 * Add statistics to export data
 */
function addStatistics(data: any[]): any[] {
  const consumptions = data
    .map(r => r.consumption)
    .filter(c => c !== null && c !== undefined);
  
  if (consumptions.length === 0) {
    return data;
  }
  
  const stats = {
    _statistics: {
      total_records: data.length,
      total_consumption: consumptions.reduce((sum, c) => sum + c, 0),
      average_consumption: consumptions.reduce((sum, c) => sum + c, 0) / consumptions.length,
      min_consumption: Math.min(...consumptions),
      max_consumption: Math.max(...consumptions),
      anomaly_count: data.filter(r => r.anomaly_flag).length,
      approval_pending: data.filter(r => r.approval_status === 'pending').length,
    },
  };
  
  return [stats, ...data];
}

/**
 * Filter columns in export data
 */
function filterColumns(data: any[], columns: string[]): any[] {
  return data.map(row => {
    const filtered: any = {};
    for (const col of columns) {
      if (col in row) {
        filtered[col] = row[col];
      }
    }
    return filtered;
  });
}