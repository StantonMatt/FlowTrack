/**
 * Generate a unique account number for a customer
 */
export function generateAccountNumber(prefix: string = 'ACC'): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Validate account number format
 */
export function isValidAccountNumber(accountNumber: string): boolean {
  // Format: PREFIX-TIMESTAMP-RANDOM
  const pattern = /^[A-Z]+-[A-Z0-9]+-[A-Z0-9]{4}$/;
  return pattern.test(accountNumber);
}

/**
 * Format account number for display
 */
export function formatAccountNumber(accountNumber: string): string {
  // Add spaces for readability: ACC-XXXX-XXXX
  const parts = accountNumber.split('-');
  if (parts.length !== 3) return accountNumber;
  return parts.join(' ');
}