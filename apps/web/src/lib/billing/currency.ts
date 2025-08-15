import { Decimal } from 'decimal.js';

export interface CurrencyConfig {
  code: string;
  symbol: string;
  decimals: number;
  thousandsSeparator: string;
  decimalSeparator: string;
}

export const CURRENCIES: Record<string, CurrencyConfig> = {
  USD: {
    code: 'USD',
    symbol: '$',
    decimals: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    decimals: 2,
    thousandsSeparator: '.',
    decimalSeparator: ',',
  },
  GBP: {
    code: 'GBP',
    symbol: '£',
    decimals: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
  },
  CAD: {
    code: 'CAD',
    symbol: 'C$',
    decimals: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
  },
};

export class MoneyCalculator {
  private currency: CurrencyConfig;
  private roundingMode: Decimal.Rounding;

  constructor(currencyCode: string = 'USD', roundingMode: Decimal.Rounding = Decimal.ROUND_HALF_UP) {
    this.currency = CURRENCIES[currencyCode] || CURRENCIES.USD;
    this.roundingMode = roundingMode;
    
    // Configure Decimal.js
    Decimal.set({
      precision: 20,
      rounding: this.roundingMode,
    });
  }

  /**
   * Round money value to currency decimals
   */
  roundMoney(value: number | string | Decimal): Decimal {
    const decimal = new Decimal(value);
    return decimal.toDecimalPlaces(this.currency.decimals, this.roundingMode);
  }

  /**
   * Calculate tax amount
   */
  calculateTax(
    subtotal: number | string | Decimal,
    taxRate: number | string | Decimal,
    mode: 'exclusive' | 'inclusive' = 'exclusive'
  ): { tax: Decimal; total: Decimal; subtotal: Decimal } {
    const subtotalDecimal = new Decimal(subtotal);
    const taxRateDecimal = new Decimal(taxRate);

    if (mode === 'exclusive') {
      // Tax added on top of subtotal
      const tax = subtotalDecimal.mul(taxRateDecimal);
      const roundedTax = this.roundMoney(tax);
      const total = subtotalDecimal.plus(roundedTax);
      
      return {
        subtotal: subtotalDecimal,
        tax: roundedTax,
        total: this.roundMoney(total),
      };
    } else {
      // Tax included in the total
      const total = subtotalDecimal;
      const subtotalWithoutTax = total.div(Decimal.add(1, taxRateDecimal));
      const roundedSubtotal = this.roundMoney(subtotalWithoutTax);
      const tax = total.minus(roundedSubtotal);
      
      return {
        subtotal: roundedSubtotal,
        tax: this.roundMoney(tax),
        total: this.roundMoney(total),
      };
    }
  }

  /**
   * Sum line items with proper precision
   */
  sumLineItems(items: Array<{ amount: number | string | Decimal }>): Decimal {
    const sum = items.reduce((acc, item) => {
      return acc.plus(new Decimal(item.amount));
    }, new Decimal(0));
    
    return this.roundMoney(sum);
  }

  /**
   * Calculate percentage discount
   */
  calculateDiscount(
    amount: number | string | Decimal,
    discountRate: number | string | Decimal
  ): { discount: Decimal; afterDiscount: Decimal } {
    const amountDecimal = new Decimal(amount);
    const discountRateDecimal = new Decimal(discountRate);
    
    const discount = amountDecimal.mul(discountRateDecimal);
    const roundedDiscount = this.roundMoney(discount);
    const afterDiscount = amountDecimal.minus(roundedDiscount);
    
    return {
      discount: roundedDiscount,
      afterDiscount: this.roundMoney(afterDiscount),
    };
  }

  /**
   * Format money for display
   */
  formatMoney(value: number | string | Decimal): string {
    const decimal = new Decimal(value);
    const rounded = this.roundMoney(decimal);
    
    // Convert to fixed decimal places
    const fixed = rounded.toFixed(this.currency.decimals);
    
    // Add thousands separators
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, this.currency.thousandsSeparator);
    
    // Join with decimal separator
    const formatted = parts.join(this.currency.decimalSeparator);
    
    return `${this.currency.symbol}${formatted}`;
  }

  /**
   * Parse money string to Decimal
   */
  parseMoney(value: string): Decimal {
    // Remove currency symbol and thousands separators
    let cleaned = value.replace(this.currency.symbol, '').trim();
    cleaned = cleaned.replace(new RegExp(`\\${this.currency.thousandsSeparator}`, 'g'), '');
    
    // Replace decimal separator with dot for parsing
    if (this.currency.decimalSeparator !== '.') {
      cleaned = cleaned.replace(this.currency.decimalSeparator, '.');
    }
    
    return new Decimal(cleaned);
  }

  /**
   * Convert between currencies (requires exchange rate)
   */
  convertCurrency(
    amount: number | string | Decimal,
    exchangeRate: number | string | Decimal,
    toCurrencyCode: string
  ): Decimal {
    const amountDecimal = new Decimal(amount);
    const rateDecimal = new Decimal(exchangeRate);
    
    const converted = amountDecimal.mul(rateDecimal);
    
    // Round to target currency decimals
    const toCurrency = CURRENCIES[toCurrencyCode] || CURRENCIES.USD;
    return converted.toDecimalPlaces(toCurrency.decimals, this.roundingMode);
  }

  /**
   * Calculate compound interest (for late fees)
   */
  calculateCompoundInterest(
    principal: number | string | Decimal,
    annualRate: number | string | Decimal,
    days: number
  ): { interest: Decimal; total: Decimal } {
    const principalDecimal = new Decimal(principal);
    const rateDecimal = new Decimal(annualRate);
    const daysDecimal = new Decimal(days);
    
    // Daily compound interest formula: A = P(1 + r/365)^days
    const dailyRate = rateDecimal.div(365);
    const compound = Decimal.add(1, dailyRate).pow(daysDecimal);
    const total = principalDecimal.mul(compound);
    const interest = total.minus(principalDecimal);
    
    return {
      interest: this.roundMoney(interest),
      total: this.roundMoney(total),
    };
  }

  /**
   * Allocate amount proportionally (for splitting payments)
   */
  allocateProportionally(
    totalAmount: number | string | Decimal,
    weights: number[]
  ): Decimal[] {
    const total = new Decimal(totalAmount);
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    
    let allocated: Decimal[] = [];
    let allocatedSum = new Decimal(0);
    
    // Allocate all but the last item
    for (let i = 0; i < weights.length - 1; i++) {
      const proportion = weights[i] / weightSum;
      const amount = this.roundMoney(total.mul(proportion));
      allocated.push(amount);
      allocatedSum = allocatedSum.plus(amount);
    }
    
    // Last item gets the remainder to avoid rounding errors
    const remainder = total.minus(allocatedSum);
    allocated.push(this.roundMoney(remainder));
    
    return allocated;
  }
}

// Export singleton instances for common currencies
export const usdCalculator = new MoneyCalculator('USD');
export const eurCalculator = new MoneyCalculator('EUR');
export const gbpCalculator = new MoneyCalculator('GBP');
export const cadCalculator = new MoneyCalculator('CAD');

// Helper functions for common operations
export function roundMoney(value: number | string, currency: string = 'USD'): number {
  const calculator = new MoneyCalculator(currency);
  return calculator.roundMoney(value).toNumber();
}

export function formatMoney(value: number | string, currency: string = 'USD'): string {
  const calculator = new MoneyCalculator(currency);
  return calculator.formatMoney(value);
}

export function calculateTax(
  subtotal: number,
  taxRate: number,
  currency: string = 'USD'
): { subtotal: number; tax: number; total: number } {
  const calculator = new MoneyCalculator(currency);
  const result = calculator.calculateTax(subtotal, taxRate);
  
  return {
    subtotal: result.subtotal.toNumber(),
    tax: result.tax.toNumber(),
    total: result.total.toNumber(),
  };
}