import * as XLSX from 'xlsx';
import { z } from 'zod';
import { format, parse, isValid } from 'date-fns';
import { 
  customerImportSchema, 
  readingImportSchema,
  type CustomerImportData,
  type ReadingImportData,
  type ImportResult,
  type ImportError,
  type ImportOptions
} from './csv-parser';

/**
 * Parse Excel file for customer data
 */
export async function parseCustomerExcel(
  file: File,
  options: ImportOptions = {}
): Promise<ImportResult<CustomerImportData>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        
        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          blankrows: false,
        });

        if (jsonData.length < 2) {
          resolve({
            success: false,
            data: [],
            errors: [{ row: 0, message: 'No data found in Excel file' }],
            totalRows: 0,
            validRows: 0,
            invalidRows: 0,
          });
          return;
        }

        // Process data
        const headers = jsonData[0] as string[];
        const rows = jsonData.slice(1);
        
        const errors: ImportError[] = [];
        const validData: CustomerImportData[] = [];
        
        rows.forEach((row: any[], index: number) => {
          try {
            // Convert array to object using headers
            const rowObj: any = {};
            headers.forEach((header, i) => {
              rowObj[header] = row[i];
            });
            
            // Normalize and validate
            const normalized = normalizeExcelCustomerData(rowObj);
            const validated = customerImportSchema.parse(normalized);
            validData.push(validated);
          } catch (error) {
            if (error instanceof z.ZodError) {
              error.errors.forEach((err) => {
                errors.push({
                  row: index + 2,
                  field: err.path.join('.'),
                  value: row[headers.indexOf(err.path[0] as string)],
                  message: err.message,
                });
              });
            } else {
              errors.push({
                row: index + 2,
                message: String(error),
              });
            }
          }
        });

        resolve({
          success: errors.length === 0,
          data: validData,
          errors,
          totalRows: rows.length,
          validRows: validData.length,
          invalidRows: errors.length,
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read Excel file'));
    };

    reader.readAsBinaryString(file);
  });
}

/**
 * Parse Excel file for reading data
 */
export async function parseReadingExcel(
  file: File,
  options: ImportOptions = {}
): Promise<ImportResult<ReadingImportData>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        
        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          blankrows: false,
        });

        if (jsonData.length < 2) {
          resolve({
            success: false,
            data: [],
            errors: [{ row: 0, message: 'No data found in Excel file' }],
            totalRows: 0,
            validRows: 0,
            invalidRows: 0,
          });
          return;
        }

        // Process data
        const headers = jsonData[0] as string[];
        const rows = jsonData.slice(1);
        
        const errors: ImportError[] = [];
        const validData: ReadingImportData[] = [];
        
        rows.forEach((row: any[], index: number) => {
          try {
            // Convert array to object using headers
            const rowObj: any = {};
            headers.forEach((header, i) => {
              rowObj[header] = row[i];
            });
            
            // Normalize and validate
            const normalized = normalizeExcelReadingData(rowObj, options.dateFormat);
            const validated = readingImportSchema.parse(normalized);
            validData.push(validated);
          } catch (error) {
            if (error instanceof z.ZodError) {
              error.errors.forEach((err) => {
                errors.push({
                  row: index + 2,
                  field: err.path.join('.'),
                  value: row[headers.indexOf(err.path[0] as string)],
                  message: err.message,
                });
              });
            } else {
              errors.push({
                row: index + 2,
                message: String(error),
              });
            }
          }
        });

        resolve({
          success: errors.length === 0,
          data: validData,
          errors,
          totalRows: rows.length,
          validRows: validData.length,
          invalidRows: errors.length,
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read Excel file'));
    };

    reader.readAsBinaryString(file);
  });
}

/**
 * Normalize Excel customer data
 */
function normalizeExcelCustomerData(row: any): any {
  const normalized: any = {};

  // Map common field variations
  const fieldMappings: Record<string, string[]> = {
    account_number: ['account_number', 'account', 'acc_number', 'customer_id'],
    first_name: ['first_name', 'firstname', 'fname'],
    last_name: ['last_name', 'lastname', 'lname'],
    email: ['email', 'email_address', 'e_mail'],
    phone: ['phone', 'phone_number', 'telephone', 'mobile'],
    service_address: ['service_address', 'address', 'street_address'],
    city: ['city', 'town'],
    state: ['state', 'province', 'region'],
    postal_code: ['postal_code', 'zip', 'zip_code', 'postcode'],
    meter_number: ['meter_number', 'meter_id', 'meter'],
  };

  // Map fields using variations
  for (const [targetField, variations] of Object.entries(fieldMappings)) {
    for (const variation of variations) {
      if (row[variation] !== undefined && row[variation] !== null && row[variation] !== '') {
        normalized[targetField] = String(row[variation]).trim();
        break;
      }
    }
  }

  // Handle optional fields
  if (row.billing_address) normalized.billing_address = String(row.billing_address).trim();
  if (row.status) normalized.status = String(row.status).toLowerCase().trim();
  if (row.customer_type) normalized.customer_type = String(row.customer_type).toLowerCase().trim();
  if (row.rate_code) normalized.rate_code = String(row.rate_code).trim();
  if (row.connection_date) normalized.connection_date = normalizeExcelDate(row.connection_date);
  if (row.notes) normalized.notes = String(row.notes).trim();

  // Clean phone number
  if (normalized.phone) {
    normalized.phone = normalized.phone.replace(/\D/g, '');
  }

  // Uppercase state code
  if (normalized.state) {
    normalized.state = normalized.state.toUpperCase();
  }

  return normalized;
}

/**
 * Normalize Excel reading data
 */
function normalizeExcelReadingData(row: any, dateFormat?: string): any {
  const normalized: any = {};

  // Map common field variations
  const fieldMappings: Record<string, string[]> = {
    account_number: ['account_number', 'account', 'customer_id'],
    meter_number: ['meter_number', 'meter_id', 'meter'],
    reading_date: ['reading_date', 'date', 'read_date'],
    reading_value: ['reading_value', 'value', 'reading', 'meter_reading'],
  };

  // Map required fields
  for (const [targetField, variations] of Object.entries(fieldMappings)) {
    for (const variation of variations) {
      if (row[variation] !== undefined && row[variation] !== null && row[variation] !== '') {
        if (targetField === 'reading_value') {
          normalized[targetField] = parseFloat(row[variation]);
        } else if (targetField === 'reading_date') {
          normalized[targetField] = normalizeExcelDate(row[variation], dateFormat);
        } else {
          normalized[targetField] = String(row[variation]).trim();
        }
        break;
      }
    }
  }

  // Handle optional fields
  if (row.reading_type) normalized.reading_type = String(row.reading_type).toLowerCase().trim();
  if (row.reader_id) normalized.reader_id = String(row.reader_id).trim();
  if (row.notes) normalized.notes = String(row.notes).trim();
  if (row.photo_url) normalized.photo_url = String(row.photo_url).trim();
  if (row.latitude) normalized.latitude = parseFloat(row.latitude);
  if (row.longitude) normalized.longitude = parseFloat(row.longitude);

  return normalized;
}

/**
 * Normalize Excel date to ISO format
 */
function normalizeExcelDate(value: any, dateFormat?: string): string {
  if (!value) return '';

  // If it's already a Date object (Excel dates are parsed as Date by XLSX)
  if (value instanceof Date) {
    return format(value, 'yyyy-MM-dd');
  }

  // If already ISO format
  if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
    return value.split('T')[0];
  }

  // Try to parse Excel serial date
  if (typeof value === 'number') {
    // Excel stores dates as number of days since 1900-01-01
    const excelEpoch = new Date(1900, 0, 1);
    const date = new Date(excelEpoch.getTime() + (value - 1) * 24 * 60 * 60 * 1000);
    return format(date, 'yyyy-MM-dd');
  }

  // Try common date formats
  const formats = [
    'MM/dd/yyyy',
    'M/d/yyyy',
    'dd/MM/yyyy',
    'd/M/yyyy',
    'yyyy-MM-dd',
    'dd.MM.yyyy',
    'yyyy/MM/dd',
  ];

  if (dateFormat) {
    formats.unshift(dateFormat);
  }

  for (const fmt of formats) {
    try {
      const parsed = parse(String(value), fmt, new Date());
      if (isValid(parsed)) {
        return format(parsed, 'yyyy-MM-dd');
      }
    } catch {
      // Try next format
    }
  }

  // Return original value if no format works
  return String(value);
}

/**
 * Generate Excel template for customers
 */
export function generateCustomerExcelTemplate(): Blob {
  const headers = [
    'account_number',
    'first_name',
    'last_name',
    'email',
    'phone',
    'service_address',
    'city',
    'state',
    'postal_code',
    'meter_number',
    'billing_address',
    'status',
    'customer_type',
    'rate_code',
    'connection_date',
    'notes',
  ];

  const sample = [
    'ACC-001234',
    'John',
    'Doe',
    'john.doe@example.com',
    '1234567890',
    '123 Main St',
    'Springfield',
    'CA',
    '90210',
    'MTR-456789',
    '123 Main St',
    'active',
    'residential',
    'RES-STD',
    '2024-01-01',
    'Sample customer',
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  
  // Auto-size columns
  const colWidths = headers.map((h, i) => ({
    wch: Math.max(h.length, String(sample[i]).length) + 2
  }));
  ws['!cols'] = colWidths;

  // Convert to blob
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });
  const buf = new ArrayBuffer(wbout.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < wbout.length; i++) {
    view[i] = wbout.charCodeAt(i) & 0xFF;
  }
  
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Generate Excel template for readings
 */
export function generateReadingExcelTemplate(): Blob {
  const headers = [
    'account_number',
    'meter_number',
    'reading_date',
    'reading_value',
    'reading_type',
    'reader_id',
    'notes',
  ];

  const sample = [
    'ACC-001234',
    'MTR-456789',
    '2024-01-15',
    '12345.678',
    'manual',
    'EMP-001',
    'Clear reading',
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Readings');
  
  // Auto-size columns
  const colWidths = headers.map((h, i) => ({
    wch: Math.max(h.length, String(sample[i]).length) + 2
  }));
  ws['!cols'] = colWidths;

  // Convert to blob
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });
  const buf = new ArrayBuffer(wbout.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < wbout.length; i++) {
    view[i] = wbout.charCodeAt(i) & 0xFF;
  }
  
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Export data to Excel
 */
export function exportToExcel<T extends Record<string, any>>(
  data: T[],
  filename: string,
  sheetName = 'Sheet1'
): void {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  // Auto-size columns
  if (data.length > 0) {
    const headers = Object.keys(data[0]);
    const colWidths = headers.map(h => {
      const maxLength = Math.max(
        h.length,
        ...data.map(row => String(row[h] || '').length)
      );
      return { wch: Math.min(maxLength + 2, 50) };
    });
    ws['!cols'] = colWidths;
  }

  XLSX.writeFile(wb, filename);
}