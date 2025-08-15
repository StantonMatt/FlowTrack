import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  PDFViewer,
  Image,
  Font,
  pdf,
} from '@react-pdf/renderer';
import { format } from 'date-fns';

// Register fonts (optional - uses Helvetica by default)
// Font.register({
//   family: 'Inter',
//   src: '/fonts/Inter-Regular.ttf',
// });

// Define styles
const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    padding: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  logo: {
    width: 100,
    height: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 10,
    color: '#666666',
  },
  section: {
    margin: 10,
    padding: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  col: {
    flexDirection: 'column',
  },
  label: {
    fontSize: 10,
    color: '#666666',
    marginBottom: 2,
  },
  value: {
    fontSize: 12,
    color: '#000000',
  },
  table: {
    marginTop: 20,
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingBottom: 5,
    marginBottom: 10,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
  },
  tableCol: {
    flex: 1,
    fontSize: 10,
  },
  tableColDescription: {
    flex: 3,
    fontSize: 10,
  },
  tableColAmount: {
    flex: 1,
    fontSize: 10,
    textAlign: 'right',
  },
  tableHeaderText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    marginVertical: 10,
  },
  totalSection: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#000000',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 5,
  },
  totalLabel: {
    fontSize: 12,
    marginRight: 20,
    width: 100,
    textAlign: 'right',
  },
  totalValue: {
    fontSize: 12,
    width: 100,
    textAlign: 'right',
  },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#000000',
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 20,
    width: 100,
    textAlign: 'right',
  },
  grandTotalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    width: 100,
    textAlign: 'right',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 40,
    right: 40,
  },
  footerText: {
    fontSize: 10,
    color: '#666666',
    textAlign: 'center',
  },
  paymentInstructions: {
    marginTop: 30,
    padding: 15,
    backgroundColor: '#f5f5f5',
  },
  paymentTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  paymentText: {
    fontSize: 10,
    marginBottom: 5,
  },
  stampWatermark: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) rotate(-45deg)',
    fontSize: 60,
    opacity: 0.1,
    color: '#000000',
  },
});

export interface InvoiceData {
  // Tenant info
  tenantName: string;
  tenantLogo?: string;
  tenantAddress?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  tenantEmail?: string;
  tenantPhone?: string;
  
  // Invoice details
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  
  // Customer info
  customerName: string;
  customerAddress?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  customerEmail?: string;
  customerPhone?: string;
  accountNumber?: string;
  
  // Line items
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  
  // Totals
  subtotal: number;
  tax: number;
  taxRate?: number;
  discount?: number;
  discountRate?: number;
  total: number;
  amountPaid?: number;
  balanceDue?: number;
  
  // Payment info
  paymentInstructions?: string;
  bankDetails?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    routingNumber?: string;
    swiftCode?: string;
  };
  
  // Custom theme
  primaryColor?: string;
  accentColor?: string;
}

// Invoice PDF Document Component
export const InvoicePDFDocument: React.FC<{ data: InvoiceData }> = ({ data }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatAddress = (address?: { street: string; city: string; state: string; zip: string }) => {
    if (!address) return '';
    return `${address.street}\n${address.city}, ${address.state} ${address.zip}`;
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Watermark for status */}
        {data.status === 'paid' && (
          <Text style={styles.stampWatermark}>PAID</Text>
        )}
        {data.status === 'cancelled' && (
          <Text style={styles.stampWatermark}>CANCELLED</Text>
        )}
        {data.status === 'overdue' && (
          <Text style={styles.stampWatermark}>OVERDUE</Text>
        )}

        {/* Header */}
        <View style={styles.header}>
          <View>
            {data.tenantLogo ? (
              <Image style={styles.logo} src={data.tenantLogo} />
            ) : (
              <Text style={styles.title}>{data.tenantName}</Text>
            )}
            {data.tenantAddress && (
              <Text style={styles.subtitle}>
                {formatAddress(data.tenantAddress)}
              </Text>
            )}
            {data.tenantEmail && (
              <Text style={styles.subtitle}>{data.tenantEmail}</Text>
            )}
            {data.tenantPhone && (
              <Text style={styles.subtitle}>{data.tenantPhone}</Text>
            )}
          </View>
          
          <View>
            <Text style={styles.title}>INVOICE</Text>
            <Text style={styles.value}>#{data.invoiceNumber}</Text>
          </View>
        </View>

        {/* Invoice Details and Customer Info */}
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>Bill To:</Text>
            <Text style={styles.value}>{data.customerName}</Text>
            {data.customerAddress && (
              <Text style={styles.subtitle}>
                {formatAddress(data.customerAddress)}
              </Text>
            )}
            {data.customerEmail && (
              <Text style={styles.subtitle}>{data.customerEmail}</Text>
            )}
            {data.accountNumber && (
              <Text style={styles.subtitle}>Account: {data.accountNumber}</Text>
            )}
          </View>
          
          <View style={styles.col}>
            <View style={styles.row}>
              <Text style={styles.label}>Issue Date:</Text>
              <Text style={styles.value}>
                {format(new Date(data.issueDate), 'MMM dd, yyyy')}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Due Date:</Text>
              <Text style={styles.value}>
                {format(new Date(data.dueDate), 'MMM dd, yyyy')}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Status:</Text>
              <Text style={styles.value}>
                {data.status.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableColDescription, styles.tableHeaderText]}>
              Description
            </Text>
            <Text style={[styles.tableCol, styles.tableHeaderText]}>
              Qty
            </Text>
            <Text style={[styles.tableColAmount, styles.tableHeaderText]}>
              Unit Price
            </Text>
            <Text style={[styles.tableColAmount, styles.tableHeaderText]}>
              Amount
            </Text>
          </View>
          
          {data.items.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={styles.tableColDescription}>
                {item.description}
              </Text>
              <Text style={styles.tableCol}>
                {item.quantity}
              </Text>
              <Text style={styles.tableColAmount}>
                {formatCurrency(item.unitPrice)}
              </Text>
              <Text style={styles.tableColAmount}>
                {formatCurrency(item.amount)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>
              {formatCurrency(data.subtotal)}
            </Text>
          </View>
          
          {data.discount && data.discount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                Discount {data.discountRate ? `(${data.discountRate}%)` : ''}:
              </Text>
              <Text style={styles.totalValue}>
                -{formatCurrency(data.discount)}
              </Text>
            </View>
          )}
          
          {data.tax > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                Tax {data.taxRate ? `(${data.taxRate}%)` : ''}:
              </Text>
              <Text style={styles.totalValue}>
                {formatCurrency(data.tax)}
              </Text>
            </View>
          )}
          
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>Total Due:</Text>
            <Text style={styles.grandTotalValue}>
              {formatCurrency(data.total)}
            </Text>
          </View>
          
          {data.amountPaid && data.amountPaid > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Amount Paid:</Text>
                <Text style={styles.totalValue}>
                  {formatCurrency(data.amountPaid)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Balance Due:</Text>
                <Text style={styles.totalValue}>
                  {formatCurrency(data.balanceDue || 0)}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Payment Instructions */}
        {(data.paymentInstructions || data.bankDetails) && (
          <View style={styles.paymentInstructions}>
            <Text style={styles.paymentTitle}>Payment Information</Text>
            {data.paymentInstructions && (
              <Text style={styles.paymentText}>{data.paymentInstructions}</Text>
            )}
            {data.bankDetails && (
              <>
                <Text style={styles.paymentText}>
                  Bank: {data.bankDetails.bankName}
                </Text>
                <Text style={styles.paymentText}>
                  Account Name: {data.bankDetails.accountName}
                </Text>
                <Text style={styles.paymentText}>
                  Account Number: {data.bankDetails.accountNumber}
                </Text>
                {data.bankDetails.routingNumber && (
                  <Text style={styles.paymentText}>
                    Routing Number: {data.bankDetails.routingNumber}
                  </Text>
                )}
                {data.bankDetails.swiftCode && (
                  <Text style={styles.paymentText}>
                    SWIFT Code: {data.bankDetails.swiftCode}
                  </Text>
                )}
              </>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Thank you for your business!
          </Text>
          <Text style={styles.footerText}>
            {data.tenantName} • {data.tenantEmail} • {data.tenantPhone}
          </Text>
        </View>
      </Page>
    </Document>
  );
};

// Generate PDF buffer
export async function generateInvoicePDF(data: InvoiceData): Promise<Uint8Array> {
  const doc = <InvoicePDFDocument data={data} />;
  const blob = await pdf(doc).toBlob();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

// Generate PDF data URL (for preview)
export async function generateInvoicePDFDataURL(data: InvoiceData): Promise<string> {
  const doc = <InvoicePDFDocument data={data} />;
  const blob = await pdf(doc).toBlob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}