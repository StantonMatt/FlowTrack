import { Resend } from 'resend';
import { render } from '@react-email/render';

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  tags?: Array<{
    name: string;
    value: string;
  }>;
  headers?: Record<string, string>;
}

export interface EmailResult {
  id?: string;
  success: boolean;
  error?: string;
}

/**
 * Send an email using Resend
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const { data, error } = await resend.emails.send({
      from: options.from || process.env.RESEND_FROM_EMAIL || 'noreply@flowtrack.com',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      attachments: options.attachments,
      tags: options.tags,
      headers: options.headers,
    });

    if (error) {
      console.error('Resend error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email',
      };
    }

    return {
      id: data?.id,
      success: true,
    };
  } catch (error) {
    console.error('Email send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send a batch of emails
 */
export async function sendBatchEmails(
  emails: EmailOptions[]
): Promise<EmailResult[]> {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const batch = emails.map(email => ({
      from: email.from || process.env.RESEND_FROM_EMAIL || 'noreply@flowtrack.com',
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      reply_to: email.replyTo,
      cc: email.cc,
      bcc: email.bcc,
      attachments: email.attachments,
      tags: email.tags,
      headers: email.headers,
    }));

    const { data, error } = await resend.batch.send(batch);

    if (error) {
      console.error('Resend batch error:', error);
      return emails.map(() => ({
        success: false,
        error: error.message || 'Failed to send batch emails',
      }));
    }

    return data?.data?.map((result: any) => ({
      id: result.id,
      success: true,
    })) || [];
  } catch (error) {
    console.error('Batch email send error:', error);
    return emails.map(() => ({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Render a React email template to HTML
 */
export async function renderEmailTemplate(
  template: React.ReactElement
): Promise<string> {
  try {
    return await render(template);
  } catch (error) {
    console.error('Email template render error:', error);
    throw error;
  }
}

/**
 * Validate email address format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate multiple email addresses
 */
export function validateEmails(emails: string | string[]): {
  valid: string[];
  invalid: string[];
} {
  const emailList = Array.isArray(emails) ? emails : [emails];
  const valid: string[] = [];
  const invalid: string[] = [];

  emailList.forEach(email => {
    if (isValidEmail(email)) {
      valid.push(email);
    } else {
      invalid.push(email);
    }
  });

  return { valid, invalid };
}

/**
 * Format email with name
 */
export function formatEmailWithName(email: string, name?: string): string {
  if (!name) return email;
  return `${name} <${email}>`;
}

/**
 * Extract email from formatted string
 */
export function extractEmail(formattedEmail: string): string {
  const match = formattedEmail.match(/<(.+)>/);
  return match ? match[1] : formattedEmail;
}

/**
 * Get domain from email
 */
export function getEmailDomain(email: string): string {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1] : '';
}