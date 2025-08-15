import Papa from 'papaparse';
import { z } from 'zod';
import { format, parse, isValid } from 'date-fns';

// Schema for customer import
export const customerImportSchema = z.object({
  account_number: z.string().min(1).max(50),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(10),
  service_address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  postal_code: z.string().min(5),
  meter_number: z.string().min(1),
  billing_address: z.string().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional().default('active'),
  customer_type: z.enum(['residential', 'commercial', 'industrial']).optional().default('residential'),
  rate_code: z.string().optional(),
  connection_date: z.string().optional(),
  notes: z.string().optional(),
});

// Schema for reading import
export const readingImportSchema = z.object({
  account_number: z.string().min(1),
  meter_number: z.string().min(1),
  reading_date: z.string().min(1),
  reading_value: z.number().positive(),
  reading_type: z.enum(['manual', 'automatic', 'estimated']).optional().default('manual'),
  reader_id: z.string().optional(),
  notes: z.string().optional(),
  photo_url: z.string().url().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export type CustomerImportData = z.infer<typeof customerImportSchema>;
export type ReadingImportData = z.infer<typeof readingImportSchema>;

export interface ImportResult<T> {
  success: boolean;
  data: T[];
  errors: ImportError[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

export interface ImportError {
  row: number;
  field?: string;
  value?: any;
  message: string;
}

export interface ImportOptions {
  skipDuplicates?: boolean;
  updateExisting?: boolean;
  validateOnly?: boolean;
  dateFormat?: string;
  delimiter?: string;
  encoding?: string;
}

/**
 * Parse CSV file for customer data
 */
export async function parseCustomerCSV(
  file: File,
  options: ImportOptions = {}
): Promise<ImportResult<CustomerImportData>> {
  return new Promise((resolve) => {
    const errors: ImportError[] = [];
    const validData: CustomerImportData[] = [];
    let totalRows = 0;

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      delimiter: options.delimiter,
      encoding: options.encoding || 'UTF-8',
      complete: (results) => {
        totalRows = results.data.length;

        results.data.forEach((row: any, index: number) => {
          try {
            // Clean and normalize data
            const cleanedRow = normalizeCustomerData(row);
            
            // Validate against schema
            const validated = customerImportSchema.parse(cleanedRow);
            validData.push(validated);
          } catch (error) {
            if (error instanceof z.ZodError) {
              error.errors.forEach((err) => {
                errors.push({
                  row: index + 2, // +2 because of header and 0-index
                  field: err.path.join('.'),
                  value: row[err.path[0]],
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
          totalRows,
          validRows: validData.length,
          invalidRows: errors.length,
        });
      },
      error: (error) => {
        resolve({
          success: false,
          data: [],
          errors: [{ row: 0, message: error.message }],
          totalRows: 0,
          validRows: 0,
          invalidRows: 0,
        });
      },
    });
  });
}

/**
 * Parse CSV file for reading data
 */
export async function parseReadingCSV(
  file: File,
  options: ImportOptions = {}
): Promise<ImportResult<ReadingImportData>> {
  return new Promise((resolve) => {
    const errors: ImportError[] = [];
    const validData: ReadingImportData[] = [];
    let totalRows = 0;

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      delimiter: options.delimiter,
      encoding: options.encoding || 'UTF-8',
      complete: (results) => {
        totalRows = results.data.length;

        results.data.forEach((row: any, index: number) => {
          try {
            // Clean and normalize data
            const cleanedRow = normalizeReadingData(row, options.dateFormat);
            
            // Validate against schema
            const validated = readingImportSchema.parse(cleanedRow);
            validData.push(validated);
          } catch (error) {
            if (error instanceof z.ZodError) {
              error.errors.forEach((err) => {
                errors.push({
                  row: index + 2,
                  field: err.path.join('.'),
                  value: row[err.path[0]],
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
          totalRows,
          validRows: validData.length,
          invalidRows: errors.length,
        });
      },
      error: (error) => {
        resolve({
          success: false,
          data: [],
          errors: [{ row: 0, message: error.message }],
          totalRows: 0,
          validRows: 0,
          invalidRows: 0,
        });
      },
    });
  });
}

/**
 * Normalize customer data
 */
function normalizeCustomerData(row: any): any {
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
      if (row[variation] !== undefined && row[variation] !== null) {
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
  if (row.connection_date) normalized.connection_date = normalizeDate(row.connection_date);
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
 * Normalize reading data
 */
function normalizeReadingData(row: any, dateFormat?: string): any {
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
      if (row[variation] !== undefined && row[variation] !== null) {
        if (targetField === 'reading_value') {
          normalized[targetField] = parseFloat(row[variation]);
        } else if (targetField === 'reading_date') {
          normalized[targetField] = normalizeDate(row[variation], dateFormat);
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
 * Normalize date to ISO format
 */
function normalizeDate(value: any, dateFormat?: string): string {
  if (!value) return '';

  // If already ISO format
  if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
    return value.split('T')[0];
  }

  // Try to parse Excel serial date
  if (typeof value === 'number') {
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
 * Generate CSV template
 */
export function generateCustomerTemplate(): string {
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

  return [headers.join(','), sample.join(',')].join('\n');
}

/**
 * Generate reading CSV template
 */
export function generateReadingTemplate(): string {
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

  return [headers.join(','), sample.join(',')].join('\n');
}

/**
 * Export data to CSV
 */
export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  filename: string
): void {
  const csv = Papa.unparse(data, {
    header: true,
    skipEmptyLines: true,
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}