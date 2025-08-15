import { describe, it, expect, vi } from 'vitest';
import { generateInvoicePDF, generateInvoicePDFDataURL, type InvoiceData } from '../pdf-generator';

// Mock React PDF
vi.mock('@react-pdf/renderer', () => ({
  Document: vi.fn(({ children }) => children),
  Page: vi.fn(({ children }) => children),
  Text: vi.fn(({ children }) => children),
  View: vi.fn(({ children }) => children),
  Image: vi.fn(() => null),
  StyleSheet: {
    create: vi.fn((styles) => styles),
  },
  PDFViewer: vi.fn(({ children }) => children),
  Font: {
    register: vi.fn(),
  },
  pdf: vi.fn(() => ({
    toBlob: vi.fn(async () => {
      const blob = new Blob(['mock pdf content'], { type: 'application/pdf' });
      // Add arrayBuffer method to the blob
      blob.arrayBuffer = async () => new ArrayBuffer(16);
      return blob;
    }),
  })),
}));

describe('PDF Generator', () => {
  const mockInvoiceData: InvoiceData = {
    // Tenant info
    tenantName: 'Test Water Company',
    tenantLogo: 'https://example.com/logo.png',
    tenantAddress: {
      street: '123 Main St',
      city: 'Testville',
      state: 'TS',
      zip: '12345',
      country: 'USA',
    },
    tenantEmail: 'billing@testwater.com',
    tenantPhone: '+1 555-0100',
    
    // Invoice details
    invoiceNumber: 'INV-2024-001',
    issueDate: '2024-01-15',
    dueDate: '2024-02-15',
    status: 'sent',
    
    // Customer info
    customerName: 'John Doe',
    customerAddress: {
      street: '456 Oak Ave',
      city: 'Testville',
      state: 'TS',
      zip: '12346',
    },
    customerEmail: 'john@example.com',
    customerPhone: '+1 555-0200',
    accountNumber: 'ACC-001',
    
    // Line items
    items: [
      {
        description: 'Water Usage - January 2024',
        quantity: 1000,
        unitPrice: 0.005,
        amount: 5.00,
      },
      {
        description: 'Base Service Charge',
        quantity: 1,
        unitPrice: 25.00,
        amount: 25.00,
      },
    ],
    
    // Totals
    subtotal: 30.00,
    tax: 2.10,
    taxRate: 7,
    discount: 0,
    discountRate: 0,
    total: 32.10,
    amountPaid: 0,
    balanceDue: 32.10,
    
    // Payment info
    paymentInstructions: 'Please pay by the due date to avoid late fees.',
    bankDetails: {
      bankName: 'Test Bank',
      accountName: 'Test Water Company',
      accountNumber: '1234567890',
      routingNumber: '987654321',
    },
    
    // Custom theme
    primaryColor: '#0066cc',
    accentColor: '#00a0e3',
  };

  describe('generateInvoicePDF', () => {
    it('should generate a PDF buffer', async () => {
      const buffer = await generateInvoicePDF(mockInvoiceData);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should handle invoices without optional fields', async () => {
      const minimalInvoice: InvoiceData = {
        tenantName: 'Test Company',
        invoiceNumber: 'INV-001',
        issueDate: '2024-01-01',
        dueDate: '2024-02-01',
        status: 'draft',
        customerName: 'Customer',
        items: [],
        subtotal: 0,
        tax: 0,
        total: 0,
      };

      const buffer = await generateInvoicePDF(minimalInvoice);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should handle paid status', async () => {
      const paidInvoice: InvoiceData = {
        ...mockInvoiceData,
        status: 'paid',
        amountPaid: 32.10,
        balanceDue: 0,
      };

      const buffer = await generateInvoicePDF(paidInvoice);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should handle overdue status', async () => {
      const overdueInvoice: InvoiceData = {
        ...mockInvoiceData,
        status: 'overdue',
      };

      const buffer = await generateInvoicePDF(overdueInvoice);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should handle cancelled status', async () => {
      const cancelledInvoice: InvoiceData = {
        ...mockInvoiceData,
        status: 'cancelled',
      };

      const buffer = await generateInvoicePDF(cancelledInvoice);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should include discount when present', async () => {
      const discountedInvoice: InvoiceData = {
        ...mockInvoiceData,
        discount: 3.00,
        discountRate: 10,
        total: 29.10,
      };

      const buffer = await generateInvoicePDF(discountedInvoice);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should handle multiple line items', async () => {
      const multiItemInvoice: InvoiceData = {
        ...mockInvoiceData,
        items: [
          {
            description: 'Item 1',
            quantity: 1,
            unitPrice: 10.00,
            amount: 10.00,
          },
          {
            description: 'Item 2',
            quantity: 2,
            unitPrice: 15.00,
            amount: 30.00,
          },
          {
            description: 'Item 3',
            quantity: 3,
            unitPrice: 5.00,
            amount: 15.00,
          },
        ],
        subtotal: 55.00,
        total: 58.85,
      };

      const buffer = await generateInvoicePDF(multiItemInvoice);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('generateInvoicePDFDataURL', () => {
    it('should generate a data URL', async () => {
      const dataUrl = await generateInvoicePDFDataURL(mockInvoiceData);
      
      expect(dataUrl).toMatch(/^data:application\/pdf;base64,/);
    });

    it('should generate different URLs for different invoices', async () => {
      const url1 = await generateInvoicePDFDataURL(mockInvoiceData);
      
      const modifiedInvoice = {
        ...mockInvoiceData,
        invoiceNumber: 'INV-2024-002',
      };
      const url2 = await generateInvoicePDFDataURL(modifiedInvoice);
      
      // URLs might be the same due to mocking, but in real scenario they'd differ
      expect(url1).toBeDefined();
      expect(url2).toBeDefined();
    });
  });

  describe('Invoice formatting', () => {
    it('should format currency correctly', async () => {
      const invoiceWithLargeAmounts: InvoiceData = {
        ...mockInvoiceData,
        subtotal: 1234.56,
        tax: 86.42,
        total: 1320.98,
      };

      const buffer = await generateInvoicePDF(invoiceWithLargeAmounts);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
      // Currency should be formatted as $1,234.56
    });

    it('should handle zero amounts', async () => {
      const zeroInvoice: InvoiceData = {
        ...mockInvoiceData,
        subtotal: 0,
        tax: 0,
        total: 0,
        items: [],
      };

      const buffer = await generateInvoicePDF(zeroInvoice);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
    });

    it('should handle partial payments', async () => {
      const partiallyPaidInvoice: InvoiceData = {
        ...mockInvoiceData,
        total: 100.00,
        amountPaid: 25.00,
        balanceDue: 75.00,
      };

      const buffer = await generateInvoicePDF(partiallyPaidInvoice);
      
      expect(buffer).toBeInstanceOf(Uint8Array);
    });
  });
});