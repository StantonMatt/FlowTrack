import { MoneyCalculator } from './currency';
import { Decimal } from 'decimal.js';

export interface RatePlan {
  id: string;
  name: string;
  currency: string;
  taxRate: number;
  baseCharge: number;
  tiers: RateTier[];
  seasons?: RateSeason[];
}

export interface RateTier {
  tierIndex: number;
  fromQty: number;
  upToQty: number | null;
  pricePerUnit: number;
  description: string;
}

export interface RateSeason {
  name: string;
  monthFrom: number;
  monthTo: number;
  multiplier: number;
}

export interface LineItem {
  lineNumber: number;
  itemType: 'consumption' | 'fee' | 'tax' | 'discount' | 'adjustment' | 'credit';
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate?: number;
  taxAmount?: number;
}

export interface BillCalculation {
  lineItems: LineItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  consumption: number;
  baseCharge: number;
  consumptionCharges: number;
}

export class RateCalculator {
  private moneyCalculator: MoneyCalculator;

  constructor(currency: string = 'USD') {
    this.moneyCalculator = new MoneyCalculator(currency);
  }

  /**
   * Calculate bill based on consumption and rate plan
   */
  calculateBill(
    consumption: number,
    ratePlan: RatePlan,
    options: {
      billingDate?: Date;
      fixedCharges?: Array<{ description: string; amount: number }>;
      discountRate?: number;
      taxExempt?: boolean;
    } = {}
  ): BillCalculation {
    const { billingDate = new Date(), fixedCharges = [], discountRate = 0, taxExempt = false } = options;
    
    const lineItems: LineItem[] = [];
    let lineNumber = 1;
    
    // Calculate base charge if any
    if (ratePlan.baseCharge > 0) {
      lineItems.push({
        lineNumber: lineNumber++,
        itemType: 'fee',
        description: 'Base Service Charge',
        quantity: 1,
        unitPrice: ratePlan.baseCharge,
        amount: ratePlan.baseCharge,
      });
    }
    
    // Calculate tiered consumption charges
    const consumptionCharges = this.calculateTieredCharges(
      consumption,
      ratePlan.tiers,
      billingDate,
      ratePlan.seasons
    );
    
    // Add consumption line items
    for (const charge of consumptionCharges.items) {
      lineItems.push({
        lineNumber: lineNumber++,
        itemType: 'consumption',
        description: charge.description,
        quantity: charge.quantity,
        unitPrice: charge.unitPrice,
        amount: charge.amount,
      });
    }
    
    // Add fixed charges
    for (const charge of fixedCharges) {
      lineItems.push({
        lineNumber: lineNumber++,
        itemType: 'fee',
        description: charge.description,
        quantity: 1,
        unitPrice: charge.amount,
        amount: charge.amount,
      });
    }
    
    // Calculate subtotal
    const subtotal = this.moneyCalculator.sumLineItems(lineItems).toNumber();
    
    // Apply discount if any
    let discountAmount = 0;
    if (discountRate > 0) {
      const discountCalc = this.moneyCalculator.calculateDiscount(subtotal, discountRate);
      discountAmount = discountCalc.discount.toNumber();
      
      if (discountAmount > 0) {
        lineItems.push({
          lineNumber: lineNumber++,
          itemType: 'discount',
          description: `Discount (${(discountRate * 100).toFixed(2)}%)`,
          quantity: 1,
          unitPrice: -discountAmount,
          amount: -discountAmount,
        });
      }
    }
    
    // Calculate tax
    let taxAmount = 0;
    if (!taxExempt && ratePlan.taxRate > 0) {
      const taxableAmount = subtotal - discountAmount;
      const taxCalc = this.moneyCalculator.calculateTax(taxableAmount, ratePlan.taxRate);
      taxAmount = taxCalc.tax.toNumber();
      
      if (taxAmount > 0) {
        lineItems.push({
          lineNumber: lineNumber++,
          itemType: 'tax',
          description: `Tax (${(ratePlan.taxRate * 100).toFixed(2)}%)`,
          quantity: 1,
          unitPrice: taxAmount,
          amount: taxAmount,
          taxRate: ratePlan.taxRate,
          taxAmount: taxAmount,
        });
      }
    }
    
    // Calculate total
    const totalAmount = this.moneyCalculator
      .roundMoney(subtotal - discountAmount + taxAmount)
      .toNumber();
    
    return {
      lineItems,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      currency: ratePlan.currency,
      consumption,
      baseCharge: ratePlan.baseCharge,
      consumptionCharges: consumptionCharges.total,
    };
  }
  
  /**
   * Calculate tiered consumption charges
   */
  private calculateTieredCharges(
    consumption: number,
    tiers: RateTier[],
    billingDate: Date,
    seasons?: RateSeason[]
  ): { items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>; total: number } {
    const items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = [];
    let remainingConsumption = consumption;
    let totalCharges = new Decimal(0);
    
    // Get seasonal multiplier if applicable
    const seasonalMultiplier = this.getSeasonalMultiplier(billingDate, seasons);
    
    // Sort tiers by fromQty to ensure correct order
    const sortedTiers = [...tiers].sort((a, b) => a.fromQty - b.fromQty);
    
    for (const tier of sortedTiers) {
      if (remainingConsumption <= 0) break;
      
      // Calculate consumption for this tier
      let tierConsumption: number;
      if (tier.upToQty === null || tier.upToQty === undefined) {
        // Open-ended tier (last tier)
        tierConsumption = remainingConsumption;
      } else {
        // Calculate the tier range
        const tierRange = tier.upToQty - tier.fromQty;
        tierConsumption = Math.min(remainingConsumption, tierRange);
      }
      
      // Apply seasonal multiplier to price
      const adjustedPrice = tier.pricePerUnit * seasonalMultiplier;
      const tierAmount = this.moneyCalculator.roundMoney(tierConsumption * adjustedPrice);
      
      if (tierConsumption > 0) {
        items.push({
          description: tier.description || this.formatTierDescription(tier),
          quantity: tierConsumption,
          unitPrice: adjustedPrice,
          amount: tierAmount.toNumber(),
        });
        
        totalCharges = totalCharges.plus(tierAmount);
        remainingConsumption -= tierConsumption;
      }
    }
    
    return {
      items,
      total: totalCharges.toNumber(),
    };
  }
  
  /**
   * Get seasonal multiplier for billing date
   */
  private getSeasonalMultiplier(billingDate: Date, seasons?: RateSeason[]): number {
    if (!seasons || seasons.length === 0) return 1.0;
    
    const month = billingDate.getMonth() + 1; // getMonth() returns 0-11
    
    for (const season of seasons) {
      // Handle seasons that wrap around year end
      if (season.monthFrom <= season.monthTo) {
        // Normal range (e.g., June to August)
        if (month >= season.monthFrom && month <= season.monthTo) {
          return season.multiplier;
        }
      } else {
        // Wrapped range (e.g., November to February)
        if (month >= season.monthFrom || month <= season.monthTo) {
          return season.multiplier;
        }
      }
    }
    
    return 1.0;
  }
  
  /**
   * Format tier description
   */
  private formatTierDescription(tier: RateTier): string {
    const from = tier.fromQty.toLocaleString();
    const to = tier.upToQty ? tier.upToQty.toLocaleString() : '+';
    const price = this.moneyCalculator.formatMoney(tier.pricePerUnit);
    
    if (tier.upToQty) {
      return `Tier ${tier.tierIndex}: ${from}-${to} gallons @ ${price}/gal`;
    } else {
      return `Tier ${tier.tierIndex}: Over ${from} gallons @ ${price}/gal`;
    }
  }
  
  /**
   * Estimate bill for a given consumption
   */
  estimateBill(
    consumption: number,
    ratePlan: RatePlan,
    includeFixed: boolean = true
  ): {
    estimatedTotal: number;
    breakdown: {
      baseCharge: number;
      consumptionCharges: number;
      estimatedTax: number;
    };
  } {
    const baseCharge = includeFixed ? ratePlan.baseCharge : 0;
    const consumptionCharges = this.calculateTieredCharges(
      consumption,
      ratePlan.tiers,
      new Date()
    );
    
    const subtotal = baseCharge + consumptionCharges.total;
    const taxCalc = this.moneyCalculator.calculateTax(subtotal, ratePlan.taxRate);
    
    return {
      estimatedTotal: taxCalc.total.toNumber(),
      breakdown: {
        baseCharge,
        consumptionCharges: consumptionCharges.total,
        estimatedTax: taxCalc.tax.toNumber(),
      },
    };
  }
  
  /**
   * Calculate pro-rated charges for partial billing periods
   */
  calculateProRated(
    consumption: number,
    ratePlan: RatePlan,
    daysInPeriod: number,
    totalDaysInMonth: number = 30
  ): BillCalculation {
    const proRateFactor = daysInPeriod / totalDaysInMonth;
    
    // Pro-rate the base charge
    const proRatedPlan: RatePlan = {
      ...ratePlan,
      baseCharge: this.moneyCalculator.roundMoney(ratePlan.baseCharge * proRateFactor).toNumber(),
    };
    
    // Calculate bill with pro-rated base charge
    const bill = this.calculateBill(consumption, proRatedPlan);
    
    // Add note about pro-rating to first line item
    if (bill.lineItems.length > 0 && bill.lineItems[0].itemType === 'fee') {
      bill.lineItems[0].description += ` (Pro-rated ${daysInPeriod}/${totalDaysInMonth} days)`;
    }
    
    return bill;
  }
  
  /**
   * Validate rate plan structure
   */
  validateRatePlan(ratePlan: RatePlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Validate basic fields
    if (!ratePlan.currency || !['USD', 'EUR', 'GBP', 'CAD'].includes(ratePlan.currency)) {
      errors.push('Invalid or unsupported currency');
    }
    
    if (ratePlan.taxRate < 0 || ratePlan.taxRate > 1) {
      errors.push('Tax rate must be between 0 and 1');
    }
    
    if (ratePlan.baseCharge < 0) {
      errors.push('Base charge cannot be negative');
    }
    
    // Validate tiers
    if (!ratePlan.tiers || ratePlan.tiers.length === 0) {
      errors.push('At least one rate tier is required');
    } else {
      // Check for gaps or overlaps
      const sortedTiers = [...ratePlan.tiers].sort((a, b) => a.fromQty - b.fromQty);
      
      for (let i = 0; i < sortedTiers.length; i++) {
        const tier = sortedTiers[i];
        
        if (tier.pricePerUnit < 0) {
          errors.push(`Tier ${tier.tierIndex}: Price per unit cannot be negative`);
        }
        
        if (tier.fromQty < 0) {
          errors.push(`Tier ${tier.tierIndex}: From quantity cannot be negative`);
        }
        
        if (tier.upToQty !== null && tier.upToQty <= tier.fromQty) {
          errors.push(`Tier ${tier.tierIndex}: Up-to quantity must be greater than from quantity`);
        }
        
        // Check for gaps between tiers
        if (i > 0) {
          const prevTier = sortedTiers[i - 1];
          if (prevTier.upToQty !== null && tier.fromQty !== prevTier.upToQty) {
            errors.push(`Gap or overlap between tier ${prevTier.tierIndex} and tier ${tier.tierIndex}`);
          }
        }
      }
      
      // Ensure last tier is open-ended
      const lastTier = sortedTiers[sortedTiers.length - 1];
      if (lastTier.upToQty !== null) {
        errors.push('Last tier should be open-ended (upToQty = null)');
      }
    }
    
    // Validate seasons if present
    if (ratePlan.seasons && ratePlan.seasons.length > 0) {
      for (const season of ratePlan.seasons) {
        if (season.monthFrom < 1 || season.monthFrom > 12) {
          errors.push(`Season ${season.name}: Invalid from month`);
        }
        if (season.monthTo < 1 || season.monthTo > 12) {
          errors.push(`Season ${season.name}: Invalid to month`);
        }
        if (season.multiplier <= 0) {
          errors.push(`Season ${season.name}: Multiplier must be positive`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Export singleton for default USD calculations
export const rateCalculator = new RateCalculator('USD');