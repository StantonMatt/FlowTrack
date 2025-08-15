import * as React from 'react';
import {
  Body,
  Button,
  Container,
  Column,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';

export interface InvoiceEmailProps {
  // Tenant branding
  tenantName: string;
  tenantLogo?: string;
  tenantAddress?: string;
  tenantPhone?: string;
  tenantEmail?: string;
  primaryColor?: string;
  
  // Customer info
  customerName: string;
  customerEmail?: string;
  
  // Invoice details
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  currency?: string;
  
  // Summary items
  summaryItems?: Array<{
    description: string;
    amount: string;
  }>;
  
  // Action URLs
  viewInvoiceUrl?: string;
  downloadPdfUrl?: string;
  paymentUrl?: string;
  
  // Options
  includePaymentButton?: boolean;
  includeDownloadButton?: boolean;
  customMessage?: string;
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
};

const box = {
  padding: '0 48px',
};

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
};

const paragraph = {
  color: '#525f7f',
  fontSize: '16px',
  lineHeight: '24px',
  textAlign: 'left' as const,
};

const button = {
  backgroundColor: '#0066cc',
  borderRadius: '5px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  width: '100%',
  padding: '12px',
};

const secondaryButton = {
  ...button,
  backgroundColor: '#ffffff',
  color: '#0066cc',
  border: '2px solid #0066cc',
};

export const InvoiceEmail: React.FC<InvoiceEmailProps> = ({
  tenantName,
  tenantLogo,
  tenantAddress,
  tenantPhone,
  tenantEmail,
  primaryColor = '#0066cc',
  customerName,
  customerEmail,
  invoiceNumber,
  invoiceDate,
  dueDate,
  totalAmount,
  currency = 'USD',
  summaryItems = [],
  viewInvoiceUrl,
  downloadPdfUrl,
  paymentUrl,
  includePaymentButton = true,
  includeDownloadButton = true,
  customMessage,
}) => {
  const previewText = `Invoice ${invoiceNumber} from ${tenantName} - ${totalAmount}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={box}>
            {/* Header with logo */}
            {tenantLogo ? (
              <Img
                src={tenantLogo}
                width="150"
                height="50"
                alt={tenantName}
                style={{ margin: '0 auto 20px' }}
              />
            ) : (
              <Heading style={{
                color: primaryColor,
                fontSize: '24px',
                fontWeight: 'bold',
                textAlign: 'center',
                margin: '0 0 20px',
              }}>
                {tenantName}
              </Heading>
            )}

            <Hr style={hr} />

            {/* Greeting */}
            <Text style={paragraph}>
              Dear {customerName},
            </Text>

            {/* Custom message or default */}
            <Text style={paragraph}>
              {customMessage || 
                `Your invoice for ${totalAmount} is now available. Please review the details below and make payment by the due date.`}
            </Text>

            {/* Invoice Summary */}
            <Section
              style={{
                backgroundColor: '#f6f9fc',
                borderRadius: '5px',
                padding: '20px',
                margin: '20px 0',
              }}
            >
              <Row>
                <Column>
                  <Text style={{ ...paragraph, margin: '0 0 10px', fontWeight: 'bold' }}>
                    Invoice Details
                  </Text>
                  <Text style={{ ...paragraph, margin: '5px 0' }}>
                    Invoice Number: <strong>{invoiceNumber}</strong>
                  </Text>
                  <Text style={{ ...paragraph, margin: '5px 0' }}>
                    Issue Date: {invoiceDate}
                  </Text>
                  <Text style={{ ...paragraph, margin: '5px 0' }}>
                    Due Date: <strong style={{ color: primaryColor }}>{dueDate}</strong>
                  </Text>
                </Column>
              </Row>
            </Section>

            {/* Line Items Summary */}
            {summaryItems.length > 0 && (
              <Section style={{ margin: '20px 0' }}>
                <Text style={{ ...paragraph, fontWeight: 'bold', marginBottom: '10px' }}>
                  Summary
                </Text>
                {summaryItems.map((item, index) => (
                  <Row key={index} style={{ marginBottom: '8px' }}>
                    <Column style={{ width: '70%' }}>
                      <Text style={{ ...paragraph, margin: 0 }}>
                        {item.description}
                      </Text>
                    </Column>
                    <Column style={{ width: '30%', textAlign: 'right' }}>
                      <Text style={{ ...paragraph, margin: 0 }}>
                        {item.amount}
                      </Text>
                    </Column>
                  </Row>
                ))}
                <Hr style={{ ...hr, marginTop: '10px' }} />
                <Row>
                  <Column style={{ width: '70%' }}>
                    <Text style={{ ...paragraph, margin: 0, fontWeight: 'bold' }}>
                      Total Due
                    </Text>
                  </Column>
                  <Column style={{ width: '30%', textAlign: 'right' }}>
                    <Text style={{ 
                      ...paragraph, 
                      margin: 0, 
                      fontWeight: 'bold',
                      fontSize: '20px',
                      color: primaryColor,
                    }}>
                      {totalAmount}
                    </Text>
                  </Column>
                </Row>
              </Section>
            )}

            {/* Total Amount (if no summary items) */}
            {summaryItems.length === 0 && (
              <Section
                style={{
                  backgroundColor: primaryColor,
                  color: '#ffffff',
                  borderRadius: '5px',
                  padding: '20px',
                  margin: '20px 0',
                  textAlign: 'center',
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: '14px', margin: '0 0 5px' }}>
                  Total Amount Due
                </Text>
                <Text style={{ 
                  color: '#ffffff', 
                  fontSize: '32px', 
                  fontWeight: 'bold',
                  margin: 0,
                }}>
                  {totalAmount}
                </Text>
              </Section>
            )}

            {/* Action Buttons */}
            <Section style={{ margin: '30px 0' }}>
              {includePaymentButton && paymentUrl && (
                <Row style={{ marginBottom: '10px' }}>
                  <Column>
                    <Button
                      href={paymentUrl}
                      style={{
                        ...button,
                        backgroundColor: primaryColor,
                      }}
                    >
                      Pay Invoice Now
                    </Button>
                  </Column>
                </Row>
              )}
              
              {viewInvoiceUrl && (
                <Row style={{ marginBottom: '10px' }}>
                  <Column>
                    <Button
                      href={viewInvoiceUrl}
                      style={includePaymentButton ? secondaryButton : { ...button, backgroundColor: primaryColor }}
                    >
                      View Invoice Online
                    </Button>
                  </Column>
                </Row>
              )}
              
              {includeDownloadButton && downloadPdfUrl && (
                <Row style={{ marginBottom: '10px' }}>
                  <Column>
                    <Button
                      href={downloadPdfUrl}
                      style={secondaryButton}
                    >
                      Download PDF
                    </Button>
                  </Column>
                </Row>
              )}
            </Section>

            <Hr style={hr} />

            {/* Footer */}
            <Section>
              <Text style={{ ...paragraph, fontSize: '14px', color: '#8898aa' }}>
                If you have any questions about this invoice, please contact us:
              </Text>
              {tenantEmail && (
                <Text style={{ ...paragraph, fontSize: '14px', margin: '5px 0' }}>
                  Email: <Link href={`mailto:${tenantEmail}`} style={{ color: primaryColor }}>{tenantEmail}</Link>
                </Text>
              )}
              {tenantPhone && (
                <Text style={{ ...paragraph, fontSize: '14px', margin: '5px 0' }}>
                  Phone: {tenantPhone}
                </Text>
              )}
              {tenantAddress && (
                <Text style={{ ...paragraph, fontSize: '14px', margin: '5px 0' }}>
                  {tenantAddress}
                </Text>
              )}
            </Section>

            <Hr style={hr} />

            <Text style={{ 
              ...paragraph, 
              fontSize: '12px', 
              color: '#8898aa',
              textAlign: 'center',
            }}>
              This is an automated email from {tenantName}. Please do not reply to this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default InvoiceEmail;