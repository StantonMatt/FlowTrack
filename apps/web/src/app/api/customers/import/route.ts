import { NextRequest, NextResponse } from 'next/server';
import { 
  withAuth, 
  withRole, 
  handleApiError,
  type ApiContext 
} from '@/lib/api/middleware';
import formidable from 'formidable';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { importRowSchema, type ImportRow } from '@flowtrack/shared/schemas/customer';
import { Readable } from 'stream';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ============================================
// POST /api/customers/import - Upload and create import job
// ============================================
export const POST = withRole('operator')(async (req: NextRequest, context: ApiContext) => {
  let tempFilePath: string | undefined;
  
  try {
    const { supabase, tenantId, user } = context;
    
    // Parse multipart form data
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content-Type must be multipart/form-data' },
        { status: 400 }
      );
    }

    // Convert NextRequest to Node.js IncomingMessage for formidable
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      allowEmptyFiles: false,
      multiples: false,
    });

    // Get the file from the request
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }

    // Validate file type
    const fileType = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 
                     file.name.toLowerCase().endsWith('.xlsx') || 
                     file.name.toLowerCase().endsWith('.xls') ? 'excel' : null;
    
    if (!fileType) {
      return NextResponse.json(
        { error: 'Invalid file type. Only CSV and Excel files are supported' },
        { status: 400 }
      );
    }

    // Save file temporarily
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `import-${Date.now()}-${file.name}`);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await fs.writeFile(tempFilePath, buffer);

    // Parse file based on type
    let parsedRows: Record<string, unknown>[] = [];
    let headers: string[] = [];
    
    if (fileType === 'csv') {
      // Parse CSV
      const fileContent = await fs.readFile(tempFilePath, 'utf-8');
      const parseResult = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      });
      
      if (parseResult.errors.length > 0) {
        console.error('CSV parse errors:', parseResult.errors);
        return NextResponse.json(
          { error: 'Failed to parse CSV file', details: parseResult.errors },
          { status: 400 }
        );
      }
      
      parsedRows = parseResult.data;
      headers = parseResult.meta.fields || [];
    } else {
      // Parse Excel
      const workbook = XLSX.readFile(tempFilePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON with headers
      const jsonData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
      }) as unknown[][];
      
      if (jsonData.length < 2) {
        return NextResponse.json(
          { error: 'Excel file must contain headers and at least one data row' },
          { status: 400 }
        );
      }
      
      // First row is headers
      headers = jsonData[0].map((h: string) => 
        String(h).trim().toLowerCase().replace(/\s+/g, '_')
      );
      
      // Convert to objects
      parsedRows = jsonData.slice(1).map(row => {
        const obj: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] || '';
        });
        return obj;
      });
    }

    // Validate we have required columns
    const requiredColumns = ['full_name', 'meter_id', 'billing_street', 'billing_city', 'billing_state', 'billing_zip'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    
    if (missingColumns.length > 0) {
      return NextResponse.json(
        { 
          error: 'Missing required columns',
          missing: missingColumns,
          found: headers,
        },
        { status: 400 }
      );
    }

    // Basic validation of rows
    interface ValidationError {
      row: number;
      errors: string[];
    }
    const validationErrors: ValidationError[] = [];
    parsedRows.forEach((row, index) => {
      try {
        // Convert row to our schema format
        const importRow: ImportRow = {
          row_number: index + 2, // +1 for header, +1 for 1-based indexing
          full_name: row.full_name || '',
          email: row.email || undefined,
          phone: row.phone || undefined,
          status: row.status || 'active',
          billing_street: row.billing_street || '',
          billing_city: row.billing_city || '',
          billing_state: row.billing_state || '',
          billing_zip: row.billing_zip || '',
          service_street: row.service_street || row.billing_street || '',
          service_city: row.service_city || row.billing_city || '',
          service_state: row.service_state || row.billing_state || '',
          service_zip: row.service_zip || row.billing_zip || '',
          meter_id: row.meter_id || '',
          meter_type: row.meter_type || 'water',
          rate_plan: row.rate_plan || undefined,
        };
        
        // Basic validation
        importRowSchema.parse(importRow);
      } catch (error) {
        if (validationErrors.length < 10) { // Limit error reporting
          validationErrors.push({
            row: index + 2,
            message: error.message || 'Validation failed',
          });
        }
      }
    });

    // Create import job
    const { data: importJob, error: jobError } = await supabase
      .from('import_jobs')
      .insert({
        tenant_id: tenantId,
        type: 'customers',
        status: validationErrors.length > 0 ? 'failed' : 'pending',
        file_name: file.name,
        total_rows: parsedRows.length,
        processed_rows: 0,
        successful_rows: 0,
        failed_rows: validationErrors.length,
        errors: validationErrors,
        created_by: user.id,
      })
      .select()
      .single();

    if (jobError) throw jobError;

    // If validation passed, store the parsed data for processing
    if (validationErrors.length === 0) {
      // Store parsed data in a temporary location or process immediately
      // For now, we'll process it immediately in the background
      processImportJob(supabase, tenantId, importJob.id, parsedRows);
    }

    // Clean up temp file
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
    }

    // Return job information
    return NextResponse.json(
      {
        success: true,
        job_id: importJob.id,
        status: importJob.status,
        total_rows: importJob.total_rows,
        validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
      },
      { status: validationErrors.length > 0 ? 400 : 202 }
    );
  } catch (error) {
    // Clean up temp file on error
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
    }
    return handleApiError(error);
  }
});

// ============================================
// Background import processor
// ============================================
async function processImportJob(
  supabase: any,
  tenantId: string,
  jobId: string,
  rows: ImportRow[]
) {
  const CHUNK_SIZE = 100;
  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  const errors: any[] = [];

  try {
    // Update job status to processing
    await supabase
      .from('import_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    // Process in chunks
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      
      for (const row of chunk) {
        try {
          // Generate account number
          const { data: accountNumber } = await supabase.rpc('generate_account_number', {
            p_tenant_id: tenantId,
            p_prefix: 'CUST',
          });

          // Create customer record
          const { error: insertError } = await supabase
            .from('customers')
            .insert({
              tenant_id: tenantId,
              account_number: accountNumber || `TEMP-${Date.now()}`,
              email: row.email,
              full_name: row.full_name,
              phone: row.phone,
              status: row.status || 'active',
              billing_address: {
                street: row.billing_street,
                city: row.billing_city,
                state: row.billing_state,
                zip: row.billing_zip,
                country: 'US',
                verified: false,
              },
              service_address: {
                street: row.service_street || row.billing_street,
                city: row.service_city || row.billing_city,
                state: row.service_state || row.billing_state,
                zip: row.service_zip || row.billing_zip,
                country: 'US',
                verified: false,
              },
              meter_id: row.meter_id,
              meter_type: row.meter_type || 'water',
              rate_plan: row.rate_plan,
              metadata: {
                imported: true,
                import_job_id: jobId,
                import_date: new Date().toISOString(),
              },
            });

          if (insertError) {
            throw insertError;
          }

          successCount++;
        } catch (error) {
          failedCount++;
          errors.push({
            row: row.row_number,
            message: error.message || 'Failed to insert customer',
            details: error.details,
          });
        }

        processedCount++;
      }

      // Update progress
      await supabase
        .from('import_jobs')
        .update({
          processed_rows: processedCount,
          successful_rows: successCount,
          failed_rows: failedCount,
          errors: errors,
        })
        .eq('id', jobId);
    }

    // Update final status
    const finalStatus = failedCount === 0 ? 'completed' : 
                       successCount === 0 ? 'failed' : 'completed';
    
    await supabase
      .from('import_jobs')
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        processed_rows: processedCount,
        successful_rows: successCount,
        failed_rows: failedCount,
        errors: errors,
      })
      .eq('id', jobId);
  } catch (error) {
    console.error('Import processing error:', error);
    
    // Update job status to failed
    await supabase
      .from('import_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        errors: [{
          message: 'Import processing failed',
          details: error,
        }],
      })
      .eq('id', jobId);
  }
}