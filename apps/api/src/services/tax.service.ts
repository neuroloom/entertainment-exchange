// Tax calculation service — per-jurisdiction rates with configurable overrides
// Supports US state sales tax, EU VAT, and custom tenant-defined rates

export interface TaxJurisdiction {
  code: string;        // e.g., "US-NY", "DE", "GB"
  name: string;
  rateBps: number;     // basis points (e.g., 8875 = 8.875%)
  type: 'sales' | 'vat' | 'gst' | 'none';
}

// US state sales tax rates (2025-2026, typical combined state+avg local)
const US_STATE_RATES: Record<string, number> = {
  AL: 4000, AK: 0, AZ: 5600, AR: 6500, CA: 7250, CO: 2900, CT: 6350, DE: 0,
  FL: 6000, GA: 4000, HI: 4000, ID: 6000, IL: 6250, IN: 7000, IA: 6000,
  KS: 6500, KY: 6000, LA: 4450, ME: 5500, MD: 6000, MA: 6250, MI: 6000,
  MN: 6875, MS: 7000, MO: 4225, MT: 0, NE: 5500, NV: 6850, NH: 0,
  NJ: 6625, NM: 5125, NY: 8875, NC: 4750, ND: 5000, OH: 5750, OK: 4500,
  OR: 0, PA: 6000, RI: 7000, SC: 6000, SD: 4500, TN: 7000, TX: 6250,
  UT: 5950, VT: 6000, VA: 5300, WA: 6500, WV: 6000, WI: 5000, WY: 4000,
  DC: 6000,
};

// EU VAT standard rates
const EU_VAT_RATES: Record<string, number> = {
  AT: 2000, BE: 2100, BG: 2000, HR: 2500, CY: 1900, CZ: 2100, DK: 2500,
  EE: 2200, FI: 2550, FR: 2000, DE: 1900, GR: 2400, HU: 2700, IE: 2300,
  IT: 2200, LV: 2100, LT: 2100, LU: 1700, MT: 1800, NL: 2100, PL: 2300,
  PT: 2300, RO: 1900, SK: 2300, SI: 2200, ES: 2100, SE: 2500,
};

const DEFAULT_TAX_JURISDICTIONS: TaxJurisdiction[] = [
  ...Object.entries(US_STATE_RATES).map(([code, rateBps]) => ({
    code: `US-${code}`, name: `United States — ${code}`, rateBps, type: 'sales' as const,
  })),
  ...Object.entries(EU_VAT_RATES).map(([code, rateBps]) => ({
    code, name: getEuCountryName(code), rateBps, type: 'vat' as const,
  })),
  { code: 'GB', name: 'United Kingdom', rateBps: 2000, type: 'vat' },
  { code: 'CA', name: 'Canada (GST)', rateBps: 500, type: 'gst' },
  { code: 'AU', name: 'Australia (GST)', rateBps: 1000, type: 'gst' },
  { code: 'JP', name: 'Japan (CT)', rateBps: 1000, type: 'sales' },
  { code: 'XX', name: 'No Tax', rateBps: 0, type: 'none' },
];

function getEuCountryName(code: string): string {
  const names: Record<string, string> = {
    AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus',
    CZ: 'Czech Republic', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France',
    DE: 'Germany', GR: 'Greece', HU: 'Hungary', IE: 'Ireland', IT: 'Italy',
    LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands',
    PL: 'Poland', PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia',
    ES: 'Spain', SE: 'Sweden',
  };
  return names[code] ?? code;
}

export interface TaxCalculation {
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  jurisdiction: TaxJurisdiction;
}

export const taxService = {
  listJurisdictions(): TaxJurisdiction[] {
    return DEFAULT_TAX_JURISDICTIONS;
  },

  getJurisdiction(code: string): TaxJurisdiction | undefined {
    return DEFAULT_TAX_JURISDICTIONS.find(j => j.code === code);
  },

  calculate(subtotalCents: number, jurisdictionCode: string): TaxCalculation {
    const jurisdiction = this.getJurisdiction(jurisdictionCode) ?? DEFAULT_TAX_JURISDICTIONS.find(j => j.code === 'XX')!;
    const taxCents = Math.round(subtotalCents * jurisdiction.rateBps / 100000);
    return {
      subtotalCents,
      taxRateBps: jurisdiction.rateBps,
      taxCents,
      totalCents: subtotalCents + taxCents,
      jurisdiction,
    };
  },

  // Calculate tax for a booking event in a specific jurisdiction
  calculateForBooking(amountCents: number, jurisdictionCode: string): TaxCalculation {
    return this.calculate(amountCents, jurisdictionCode);
  },

  // Get the effective tax rate for a location (resolves city/state/country)
  resolveRate(regionCode?: string): TaxJurisdiction {
    if (!regionCode) return DEFAULT_TAX_JURISDICTIONS.find(j => j.code === 'XX')!;
    const exact = this.getJurisdiction(regionCode);
    if (exact) return exact;
    const usState = this.getJurisdiction(`US-${regionCode.toUpperCase()}`);
    if (usState) return usState;
    return DEFAULT_TAX_JURISDICTIONS.find(j => j.code === 'XX')!;
  },
};
