import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseReadingCSV } from '@/lib/import/csv-parser';
import { parseReadingExcel } from '@/lib/import/excel-parser';
import { ConsumptionService } from '@/lib/readings/consumption-service';
import { AnomalyService } from '@/lib/readings/anomaly-service';
import type { ReadingImportData } from '@/lib/import/csv-parser';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_BATCH_SIZE = 100; // Insert in batches

/**
 * POST /api/import/readings
 * Import meter readings from CSV or Excel file
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

    // Check permissions
    const { data: role } = await supabase
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .single();

    if (!role || !['admin', 'manager', 'field_worker'].includes(role.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const optionsStr = formData.get('options') as string;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ 
        error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` 
      }, { status: 400 });
    }

    // Parse options
    const options = optionsStr ? JSON.parse(optionsStr) : {};
    const { skipDuplicates = true, updateExisting = false, validateOnly = false } = options;

    // Parse file based on type
    let parseResult;
    if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
      parseResult = await parseReadingCSV(file, options);
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      parseResult = await parseReadingExcel(file, options);
    } else {
      return NextResponse.json({ 
        error: 'Unsupported file format. Use CSV or Excel.' 
      }, { status: 400 });
    }

    // Return validation results if validateOnly
    if (validateOnly) {
      return NextResponse.json({
        success: parseResult.success,
        totalRows: parseResult.totalRows,
        validRows: parseResult.validRows,
        invalidRows: parseResult.invalidRows,
        errors: parseResult.errors,
      });
    }

    // If there are errors, return them
    if (!parseResult.success && parseResult.errors.length > 0) {
      return NextResponse.json({
        success: false,
        errors: parseResult.errors,
        totalRows: parseResult.totalRows,
        validRows: parseResult.validRows,
        invalidRows: parseResult.invalidRows,
      }, { status: 400 });
    }

    // Initialize services
    const consumptionService = new ConsumptionService(supabase);
    const anomalyService = new AnomalyService(supabase);

    // Process imports
    const importResults = {
      created: 0,
      updated: 0,
      skipped: 0,
      anomalies: 0,
      errors: [] as any[],
    };

    // Group readings by customer for better processing
    const readingsByCustomer = new Map<string, ReadingImportData[]>();
    for (const reading of parseResult.data) {
      const key = `${reading.account_number}-${reading.meter_number}`;
      if (!readingsByCustomer.has(key)) {
        readingsByCustomer.set(key, []);
      }
      readingsByCustomer.get(key)!.push(reading);
    }

    // Process each customer's readings
    for (const [customerKey, readings] of readingsByCustomer) {
      const [accountNumber, meterNumber] = customerKey.split('-');
      
      // Get customer
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('account_number', accountNumber)
        .single();

      if (!customer) {
        importResults.errors.push({
          account_number: accountNumber,
          error: 'Customer not found',
        });
        continue;
      }

      // Sort readings by date
      readings.sort((a, b) => 
        new Date(a.reading_date).getTime() - new Date(b.reading_date).getTime()
      );

      // Process each reading
      for (const reading of readings) {
        try {
          // Check if reading exists
          const { data: existing } = await supabase
            .from('meter_readings')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('customer_id', customer.id)
            .eq('reading_date', reading.reading_date)
            .single();

          if (existing) {
            if (updateExisting) {
              // Get previous reading for consumption calculation
              const previousReading = await consumptionService.getPreviousReading(
                customer.id,
                reading.reading_date,
                existing.id
              );

              // Calculate consumption
              const consumption = consumptionService.calculateConsumption(
                reading.reading_value,
                previousReading?.reading_value || null
              );

              // Check for anomalies
              const anomalyResult = await anomalyService.evaluateAnomaly(
                tenantId,
                consumption,
                previousReading?.consumption || null,
                new Date(reading.reading_date)
              );

              // Update existing reading
              const { error } = await supabase
                .from('meter_readings')
                .update({
                  reading_value: reading.reading_value,
                  reading_type: reading.reading_type || 'manual',
                  reader_id: reading.reader_id || user.id,
                  notes: reading.notes,
                  photo_url: reading.photo_url,
                  previous_reading_id: previousReading?.id,
                  previous_reading_value: previousReading?.reading_value,
                  consumption,
                  anomaly_flag: anomalyResult.isAnomaly ? anomalyResult.type : null,
                  metadata: {
                    latitude: reading.latitude,
                    longitude: reading.longitude,
                    imported_at: new Date().toISOString(),
                    imported_by: user.id,
                  },
                  updated_at: new Date().toISOString(),
                })
                .eq('id', existing.id);

              if (error) throw error;
              importResults.updated++;
              if (anomalyResult.isAnomaly) importResults.anomalies++;
            } else if (skipDuplicates) {
              importResults.skipped++;
            } else {
              importResults.errors.push({
                account_number: accountNumber,
                reading_date: reading.reading_date,
                error: 'Duplicate reading',
              });
            }
          } else {
            // Get previous reading for consumption calculation
            const previousReading = await consumptionService.getPreviousReading(
              customer.id,
              reading.reading_date
            );

            // Calculate consumption
            const consumption = consumptionService.calculateConsumption(
              reading.reading_value,
              previousReading?.reading_value || null
            );

            // Check for anomalies
            const anomalyResult = await anomalyService.evaluateAnomaly(
              tenantId,
              consumption,
              previousReading?.consumption || null,
              new Date(reading.reading_date)
            );

            // Create new reading
            const { error } = await supabase
              .from('meter_readings')
              .insert({
                tenant_id: tenantId,
                customer_id: customer.id,
                meter_number: meterNumber,
                reading_date: reading.reading_date,
                reading_value: reading.reading_value,
                reading_type: reading.reading_type || 'manual',
                reader_id: reading.reader_id || user.id,
                notes: reading.notes,
                photo_url: reading.photo_url,
                previous_reading_id: previousReading?.id,
                previous_reading_value: previousReading?.reading_value,
                consumption,
                anomaly_flag: anomalyResult.isAnomaly ? anomalyResult.type : null,
                metadata: {
                  latitude: reading.latitude,
                  longitude: reading.longitude,
                  imported_at: new Date().toISOString(),
                  imported_by: user.id,
                },
              });

            if (error) throw error;
            importResults.created++;
            if (anomalyResult.isAnomaly) importResults.anomalies++;
          }
        } catch (error: any) {
          importResults.errors.push({
            account_number: accountNumber,
            reading_date: reading.reading_date,
            error: error.message || 'Import failed',
          });
        }
      }
    }

    // Log import activity
    await supabase
      .from('audit_logs')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        action: 'import_readings',
        resource_type: 'meter_readings',
        details: {
          filename: file.name,
          fileSize: file.size,
          totalRows: parseResult.totalRows,
          created: importResults.created,
          updated: importResults.updated,
          skipped: importResults.skipped,
          anomalies: importResults.anomalies,
          errors: importResults.errors.length,
        },
      });

    return NextResponse.json({
      success: true,
      created: importResults.created,
      updated: importResults.updated,
      skipped: importResults.skipped,
      anomalies: importResults.anomalies,
      errors: importResults.errors,
      totalProcessed: parseResult.data.length,
    });
  } catch (error) {
    console.error('Reading import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}