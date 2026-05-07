// Booking quote calculator — tiered rates, add-ons, travel fees

export type EventType = 'wedding' | 'corporate' | 'birthday' | 'gala' | 'conference' | 'festival' | 'private_party';

export interface QuoteParams {
  eventType: EventType;
  durationHours: number;
  guestCount: number;
  addOns: string[];
  travelMiles: number;
}

export interface QuoteBreakdown {
  baseAmount: number;
  addOnAmount: number;
  travelFee: number;
  totalCents: number;
  breakdown: {
    base: { rate: number; amount: number };
    addOns: Array<{ name: string; rate: number; quantity?: number; amount: number }>;
    travel: { miles: number; ratePerMile: number; freeMiles: number; amount: number };
  };
}

export const BASE_RATES: Record<EventType, number> = {
  wedding: 350_000,
  corporate: 500_000,
  birthday: 80_000,
  gala: 250_000,
  conference: 180_000,
  festival: 300_000,
  private_party: 60_000,
};

/** Add-on flat rates in cents. Per-guest add-ons are identified via PER_GUEST_ADDONS. */
export const ADDON_RATES: Record<string, number> = {
  catering: 5_000,       // per guest
  photography: 150_000,   // flat
  videography: 200_000,   // flat
  sound: 75_000,          // flat
  lighting: 100_000,      // flat
  photobooth: 50_000,     // flat
  dj: 120_000,            // flat
  live_band: 250_000,     // flat
  decor: 80_000,          // flat
  security: 40_000,       // flat
  coordinator: 100_000,   // flat
  bartender: 35_000,      // flat
};

/** Add-ons that are priced per guest. */
export const PER_GUEST_ADDONS: ReadonlySet<string> = new Set(['catering']);

export const TRAVEL_RATE_PER_MILE = 200;  // $2.00/mile in cents
export const TRAVEL_FREE_MILES = 25;
export const MINIMUM_QUOTE_CENTS = 50_000;

/**
 * Calculates a quote for an event booking.
 *
 * The quote is built from three components:
 * 1. Base rate determined by event type
 * 2. Add-on costs — flat fees or per-guest rates
 * 3. Travel fee — $2/mile for distance beyond 25 miles
 *
 * The result is floored at MINIMUM_QUOTE_CENTS.
 */
export function calculateQuote(params: QuoteParams): QuoteBreakdown {
  const { eventType, guestCount, addOns, travelMiles } = params;

  // Base
  const baseRate = BASE_RATES[eventType] ?? 100_000; // fallback for unknown types
  const baseAmount = baseRate;

  // Add-ons
  const addOnLines: QuoteBreakdown['breakdown']['addOns'] = [];
  let addOnAmount = 0;

  for (const name of addOns) {
    const rate = ADDON_RATES[name];
    if (rate === undefined) continue; // skip unknown add-ons silently

    if (PER_GUEST_ADDONS.has(name)) {
      const quantity = Math.max(0, guestCount);
      const amount = rate * quantity;
      addOnLines.push({ name, rate, quantity, amount });
      addOnAmount += amount;
    } else {
      addOnLines.push({ name, rate, amount: rate });
      addOnAmount += rate;
    }
  }

  // Travel
  const chargeableMiles = Math.max(0, travelMiles - TRAVEL_FREE_MILES);
  const travelFee = chargeableMiles * TRAVEL_RATE_PER_MILE;

  // Total (with minimum floor)
  let totalCents = baseAmount + addOnAmount + travelFee;
  totalCents = Math.max(totalCents, MINIMUM_QUOTE_CENTS);

  return {
    baseAmount,
    addOnAmount,
    travelFee,
    totalCents,
    breakdown: {
      base: { rate: baseRate, amount: baseAmount },
      addOns: addOnLines,
      travel: {
        miles: travelMiles,
        ratePerMile: TRAVEL_RATE_PER_MILE,
        freeMiles: TRAVEL_FREE_MILES,
        amount: travelFee,
      },
    },
  };
}
