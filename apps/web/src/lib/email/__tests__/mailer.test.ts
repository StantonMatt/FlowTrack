import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are set up before imports
const { mockSend, mockBatchSend } = vi.hoisted(() => {
  const send = vi.fn();
  const batchSend = vi.fn();
  return { mockSend: send, mockBatchSend: batchSend };
});

// Mock Resend BEFORE importing modules that use it
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: mockSend,
    },
    batch: {
      send: mockBatchSend,
    },
  })),
}));

// Mock React Email render
vi.mock('@react-email/render', () => ({
  render: vi.fn().mockResolvedValue('<html>Rendered Email</html>'),
}));

// Now import the modules
import { 
  sendEmail, 
  sendBatchEmails,
  renderEmailTemplate,
  isValidEmail,
  validateEmails,
  formatEmailWithName,
  extractEmail,
  getEmailDomain,
} from '../mailer';

describe('Mailer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set test environment variables
    process.env.RESEND_API_KEY = 'test-api-key';
    process.env.RESEND_FROM_EMAIL = 'test@flowtrack.com';
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      mockSend.mockResolvedValue({
        data: { id: 'msg-123' },
        error: null,
      });

      const result = await sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('msg-123');
      expect(result.error).toBeUndefined();
    });

    it('should handle email send errors', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Send failed' },
      });

      const result = await sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Send failed');
    });

    it('should handle missing API key', async () => {
      delete process.env.RESEND_API_KEY;

      const result = await sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('RESEND_API_KEY is not configured');
    });

    it('should use custom from address', async () => {
      mockSend.mockResolvedValue({
        data: { id: 'msg-123' },
        error: null,
      });

      await sendEmail({
        to: 'recipient@example.com',
        from: 'custom@domain.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@domain.com',
        })
      );
    });

    it('should include attachments', async () => {
      mockSend.mockResolvedValue({
        data: { id: 'msg-123' },
        error: null,
      });

      const attachments = [
        {
          filename: 'invoice.pdf',
          content: Buffer.from('PDF content'),
          contentType: 'application/pdf',
        },
      ];

      await sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
        attachments,
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments,
        })
      );
    });
  });

  describe('sendBatchEmails', () => {
    it('should send batch emails successfully', async () => {
      mockBatchSend.mockResolvedValue({
        data: {
          data: [
            { id: 'msg-1' },
            { id: 'msg-2' },
          ],
        },
        error: null,
      });

      const emails = [
        {
          to: 'recipient1@example.com',
          subject: 'Email 1',
          html: '<p>Content 1</p>',
        },
        {
          to: 'recipient2@example.com',
          subject: 'Email 2',
          html: '<p>Content 2</p>',
        },
      ];

      const results = await sendBatchEmails(emails);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].id).toBe('msg-1');
      expect(results[1].success).toBe(true);
      expect(results[1].id).toBe('msg-2');
    });

    it('should handle batch send errors', async () => {
      mockBatchSend.mockResolvedValue({
        data: null,
        error: { message: 'Batch send failed' },
      });

      const emails = [
        {
          to: 'recipient1@example.com',
          subject: 'Email 1',
          html: '<p>Content 1</p>',
        },
      ];

      const results = await sendBatchEmails(emails);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Batch send failed');
    });
  });

  describe('renderEmailTemplate', () => {
    it('should render email template', async () => {
      const template = { type: 'div', props: { children: 'Test' } } as any;
      const html = await renderEmailTemplate(template);

      expect(html).toBe('<html>Rendered Email</html>');
    });
  });

  describe('Email validation utilities', () => {
    describe('isValidEmail', () => {
      it('should validate correct email addresses', () => {
        expect(isValidEmail('test@example.com')).toBe(true);
        expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
        expect(isValidEmail('user+tag@example.org')).toBe(true);
      });

      it('should reject invalid email addresses', () => {
        expect(isValidEmail('invalid')).toBe(false);
        expect(isValidEmail('@example.com')).toBe(false);
        expect(isValidEmail('user@')).toBe(false);
        expect(isValidEmail('user @example.com')).toBe(false);
      });
    });

    describe('validateEmails', () => {
      it('should validate multiple emails', () => {
        const result = validateEmails([
          'valid@example.com',
          'invalid',
          'another.valid@test.org',
          '@invalid.com',
        ]);

        expect(result.valid).toEqual([
          'valid@example.com',
          'another.valid@test.org',
        ]);
        expect(result.invalid).toEqual([
          'invalid',
          '@invalid.com',
        ]);
      });

      it('should handle single email string', () => {
        const result = validateEmails('test@example.com');
        expect(result.valid).toEqual(['test@example.com']);
        expect(result.invalid).toEqual([]);
      });
    });

    describe('formatEmailWithName', () => {
      it('should format email with name', () => {
        expect(formatEmailWithName('test@example.com', 'John Doe'))
          .toBe('John Doe <test@example.com>');
      });

      it('should return email only when no name provided', () => {
        expect(formatEmailWithName('test@example.com'))
          .toBe('test@example.com');
      });
    });

    describe('extractEmail', () => {
      it('should extract email from formatted string', () => {
        expect(extractEmail('John Doe <john@example.com>'))
          .toBe('john@example.com');
      });

      it('should return original string if no formatting', () => {
        expect(extractEmail('john@example.com'))
          .toBe('john@example.com');
      });
    });

    describe('getEmailDomain', () => {
      it('should extract domain from email', () => {
        expect(getEmailDomain('user@example.com')).toBe('example.com');
        expect(getEmailDomain('test@subdomain.example.org')).toBe('subdomain.example.org');
      });

      it('should return empty string for invalid email', () => {
        expect(getEmailDomain('invalid')).toBe('');
      });
    });
  });
});