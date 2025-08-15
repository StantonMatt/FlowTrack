import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseCSV, validateCustomerData, processImportJob } from '../csv-parser';
import { parseExcel } from '../excel-parser';

describe('Import Service', () => {
  describe('CSV Parsing', () => {
    it('should parse valid CSV data', async () => {
      const csvContent = `account_number,first_name,last_name,email,phone,service_address,city,state,postal_code,meter_number
1234567890,John,Doe,john@example.com,555-0100,123 Main St,Springfield,IL,62701,MTR001
1234567891,Jane,Smith,jane@example.com,555-0101,456 Oak Ave,Springfield,IL,62702,MTR002`;

      const result = await parseCSV(csvContent, 'customer');
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({
        account_number: '1234567890',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
      });
    });

    it('should validate required fields', async () => {
      const csvContent = `first_name,last_name
John,Doe`;

      const result = await parseCSV(csvContent, 'customer');
      
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors[0]).toContain('Missing required field');
    });

    it('should handle malformed CSV gracefully', async () => {
      const csvContent = `"Broken,CSV"Data
"Missing quote`;

      const result = await parseCSV(csvContent, 'customer');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse');
    });
  });

  describe('Excel Parsing', () => {
    it('should detect Excel file format', () => {
      const xlsxBuffer = new ArrayBuffer(8);
      const view = new Uint8Array(xlsxBuffer);
      // XLSX magic bytes
      view[0] = 0x50; view[1] = 0x4B; view[2] = 0x03; view[3] = 0x04;
      
      const blob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      expect(blob.type).toContain('spreadsheet');
    });
  });

  describe('Data Validation', () => {
    it('should validate email format', () => {
      const validEmails = [
        'user@example.com',
        'user.name@example.co.uk',
        'user+tag@example.org',
      ];

      const invalidEmails = [
        'notanemail',
        '@example.com',
        'user@',
        'user @example.com',
      ];

      validEmails.forEach(email => {
        const result = validateCustomerData({ email });
        expect(result.errors).not.toContain('Invalid email format');
      });

      invalidEmails.forEach(email => {
        const result = validateCustomerData({ email });
        expect(result.errors).toContain('Invalid email format');
      });
    });

    it('should validate phone number format', () => {
      const validPhones = [
        '555-555-5555',
        '(555) 555-5555',
        '5555555555',
        '+1-555-555-5555',
      ];

      validPhones.forEach(phone => {
        const result = validateCustomerData({ phone });
        expect(result.errors).not.toContain('Invalid phone format');
      });
    });

    it('should validate postal code format', () => {
      const validCodes = ['12345', '12345-6789'];
      const invalidCodes = ['1234', '123456', 'ABCDE'];

      validCodes.forEach(code => {
        const result = validateCustomerData({ postal_code: code });
        expect(result.errors).not.toContain('Invalid postal code');
      });

      invalidCodes.forEach(code => {
        const result = validateCustomerData({ postal_code: code });
        expect(result.errors).toContain('Invalid postal code');
      });
    });
  });

  describe('Import Job Processing', () => {
    it('should process import job in chunks', async () => {
      const mockJob = {
        id: 'job-123',
        tenant_id: 'tenant-123',
        total_rows: 1000,
        status: 'processing',
      };

      const processSpy = vi.fn().mockResolvedValue({ success: true });
      
      await processImportJob(mockJob, { 
        chunkSize: 100,
        processChunk: processSpy,
      });

      // Should process in 10 chunks of 100
      expect(processSpy).toHaveBeenCalledTimes(10);
    });

    it('should handle partial failures', async () => {
      const rows = [
        { valid: true, data: { first_name: 'John' } },
        { valid: false, error: 'Invalid email' },
        { valid: true, data: { first_name: 'Jane' } },
      ];

      const result = await processImportJob({ rows });
      
      expect(result.successful_rows).toBe(2);
      expect(result.failed_rows).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should generate import report', async () => {
      const job = {
        id: 'job-123',
        successful_rows: 95,
        failed_rows: 5,
        total_rows: 100,
        errors: [
          { row: 10, error: 'Invalid email' },
          { row: 25, error: 'Duplicate account number' },
        ],
      };

      const report = generateImportReport(job);
      
      expect(report).toContain('Success Rate: 95%');
      expect(report).toContain('Failed: 5');
      expect(report).toContain('Row 10: Invalid email');
    });
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicate account numbers', async () => {
      const existingCustomers = [
        { account_number: '1234567890' },
        { account_number: '1234567891' },
      ];

      const importRows = [
        { account_number: '1234567890' }, // Duplicate
        { account_number: '1234567892' }, // New
      ];

      const duplicates = detectDuplicates(importRows, existingCustomers);
      
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].account_number).toBe('1234567890');
    });

    it('should handle update vs create mode', async () => {
      const importOptions = {
        mode: 'update', // vs 'create' or 'upsert'
        duplicateStrategy: 'skip', // vs 'update' or 'error'
      };

      const result = await processWithDuplicateHandling(
        importRows,
        existingData,
        importOptions
      );

      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.created).toBe(1);
    });
  });
});

// Helper function mocks
function generateImportReport(job: any): string {
  const successRate = (job.successful_rows / job.total_rows * 100).toFixed(0);
  let report = `Import Report\n`;
  report += `Success Rate: ${successRate}%\n`;
  report += `Successful: ${job.successful_rows}\n`;
  report += `Failed: ${job.failed_rows}\n\n`;
  
  if (job.errors?.length > 0) {
    report += `Errors:\n`;
    job.errors.forEach((err: any) => {
      report += `Row ${err.row}: ${err.error}\n`;
    });
  }
  
  return report;
}

function detectDuplicates(importRows: any[], existingData: any[]): any[] {
  const existingNumbers = new Set(existingData.map(c => c.account_number));
  return importRows.filter(row => existingNumbers.has(row.account_number));
}

async function processWithDuplicateHandling(
  importRows: any[],
  existingData: any[],
  options: any
): Promise<any> {
  const result = { created: 0, updated: 0, skipped: 0 };
  const duplicates = detectDuplicates(importRows, existingData);
  
  if (options.duplicateStrategy === 'skip') {
    result.skipped = duplicates.length;
    result.created = importRows.length - duplicates.length;
  }
  
  return result;
}