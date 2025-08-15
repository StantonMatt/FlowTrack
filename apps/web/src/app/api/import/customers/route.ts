import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseCustomerCSV } from '@/lib/import/csv-parser';
import { parseCustomerExcel } from '@/lib/import/excel-parser';
import type { CustomerImportData } from '@/lib/import/csv-parser';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_BATCH_SIZE = 100; // Insert in batches

/**
 * POST /api/import/customers
 * Import customers from CSV or Excel file
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

    if (!role || !['admin', 'manager'].includes(role.role)) {
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
      parseResult = await parseCustomerCSV(file, options);
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      parseResult = await parseCustomerExcel(file, options);
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

    // Process imports
    const importResults = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as any[],
    };

    // Process in batches
    for (let i = 0; i < parseResult.data.length; i += MAX_BATCH_SIZE) {
      const batch = parseResult.data.slice(i, i + MAX_BATCH_SIZE);
      
      for (const customer of batch) {
        try {
          // Check if customer exists
          const { data: existing } = await supabase
            .from('customers')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('account_number', customer.account_number)
            .single();

          if (existing) {
            if (updateExisting) {
              // Update existing customer
              const { error } = await supabase
                .from('customers')
                .update({
                  first_name: customer.first_name,
                  last_name: customer.last_name,
                  email: customer.email,
                  phone: customer.phone,
                  service_address: customer.service_address,
                  billing_address: customer.billing_address || customer.service_address,
                  city: customer.city,
                  state: customer.state,
                  postal_code: customer.postal_code,
                  status: customer.status || 'active',
                  customer_type: customer.customer_type || 'residential',
                  meter_number: customer.meter_number,
                  metadata: {
                    rate_code: customer.rate_code,
                    connection_date: customer.connection_date,
                    notes: customer.notes,
                    imported_at: new Date().toISOString(),
                    imported_by: user.id,
                  },
                  updated_at: new Date().toISOString(),
                })
                .eq('id', existing.id);

              if (error) throw error;
              importResults.updated++;
            } else if (skipDuplicates) {
              importResults.skipped++;
            } else {
              importResults.errors.push({
                account_number: customer.account_number,
                error: 'Duplicate account number',
              });
            }
          } else {
            // Create new customer
            const { error } = await supabase
              .from('customers')
              .insert({
                tenant_id: tenantId,
                account_number: customer.account_number,
                first_name: customer.first_name,
                last_name: customer.last_name,
                email: customer.email,
                phone: customer.phone,
                service_address: customer.service_address,
                billing_address: customer.billing_address || customer.service_address,
                city: customer.city,
                state: customer.state,
                postal_code: customer.postal_code,
                status: customer.status || 'active',
                customer_type: customer.customer_type || 'residential',
                meter_number: customer.meter_number,
                metadata: {
                  rate_code: customer.rate_code,
                  connection_date: customer.connection_date,
                  notes: customer.notes,
                  imported_at: new Date().toISOString(),
                  imported_by: user.id,
                },
              });

            if (error) throw error;
            importResults.created++;
          }
        } catch (error: any) {
          importResults.errors.push({
            account_number: customer.account_number,
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
        action: 'import_customers',
        resource_type: 'customers',
        details: {
          filename: file.name,
          fileSize: file.size,
          totalRows: parseResult.totalRows,
          created: importResults.created,
          updated: importResults.updated,
          skipped: importResults.skipped,
          errors: importResults.errors.length,
        },
      });

    return NextResponse.json({
      success: true,
      created: importResults.created,
      updated: importResults.updated,
      skipped: importResults.skipped,
      errors: importResults.errors,
      totalProcessed: parseResult.data.length,
    });
  } catch (error) {
    console.error('Customer import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}