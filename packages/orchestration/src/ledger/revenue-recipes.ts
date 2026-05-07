// Revenue Recipes — double-entry templates for entertainment business revenue flows.
//
// Each recipe is a function that takes an amount (in cents) and returns
// { entries: [{ accountCode, direction, amount }] }.
//
// Account codes (seeded in the ledger route):
//   1000  Cash / Stripe Clearing    (asset)
//   2000  Deferred Revenue          (liability)
//   2100  Artist/Vendor Payable     (liability)
//   4000  Booking Revenue           (revenue)
//   4100  Commission Revenue        (revenue)
//   5000  Provider Fees             (expense)

export interface RecipeEntry {
  accountCode: string;
  direction: 'debit' | 'credit';
  amount: number;
}

export interface RecipeResult {
  entries: RecipeEntry[];
}

export type RevenueRecipe = (amount: number) => RecipeResult;

/**
 * DEPOSIT_RECIPE — When a customer deposit/payment is received.
 * Debit Cash (asset increases), Credit Deferred Revenue (liability increases).
 * Revenue is not yet recognized; it sits in deferred until the event completes.
 */
export const DEPOSIT_RECIPE: RevenueRecipe = (amount: number): RecipeResult => ({
  entries: [
    { accountCode: '1000', direction: 'debit', amount },
    { accountCode: '2000', direction: 'credit', amount },
  ],
});

/**
 * RECOGNIZE_RECIPE — When an event completes and revenue can be recognized.
 * Debit Deferred Revenue (liability decreases), Credit Booking Revenue (revenue increases).
 */
export const RECOGNIZE_RECIPE: RevenueRecipe = (amount: number): RecipeResult => ({
  entries: [
    { accountCode: '2000', direction: 'debit', amount },
    { accountCode: '4000', direction: 'credit', amount },
  ],
});

/**
 * COMMISSION_RECIPE — Commission retained by the platform from a booking.
 * Debit Commission Revenue (contra-revenue, reduces gross), Credit Cash (asset decreases).
 */
export const COMMISSION_RECIPE: RevenueRecipe = (amount: number): RecipeResult => ({
  entries: [
    { accountCode: '4100', direction: 'debit', amount },
    { accountCode: '1000', direction: 'credit', amount },
  ],
});

/**
 * PAYOUT_RECIPE — Payout to an artist/vendor.
 * Debit Artist Payable (liability decreases), Credit Cash (asset decreases).
 */
export const PAYOUT_RECIPE: RevenueRecipe = (amount: number): RecipeResult => ({
  entries: [
    { accountCode: '2100', direction: 'debit', amount },
    { accountCode: '1000', direction: 'credit', amount },
  ],
});

/**
 * Map event types to the appropriate revenue recipe.
 *
 *   deposit   → DEPOSIT_RECIPE
 *   recognize → RECOGNIZE_RECIPE
 *   commission→ COMMISSION_RECIPE
 *   payout    → PAYOUT_RECIPE
 *
 * Unknown event types throw so callers cannot silently post unbalanced entries.
 */
export function getRecipeForEvent(eventType: string): RevenueRecipe {
  const lowered = eventType.toLowerCase();
  switch (lowered) {
    case 'deposit':
      return DEPOSIT_RECIPE;
    case 'recognize':
      return RECOGNIZE_RECIPE;
    case 'commission':
      return COMMISSION_RECIPE;
    case 'payout':
      return PAYOUT_RECIPE;
    default:
      throw new Error(`Unknown revenue event type: "${eventType}"`);
  }
}

/** Verify every recipe is balanced. Returns an error string or null. */
export function verifyRecipe(recipe: RevenueRecipe, amount: number = 10000): string | null {
  const { entries } = recipe(amount);
  const debits = entries.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amount, 0);
  const credits = entries.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amount, 0);
  if (debits !== credits) {
    return `Unbalanced recipe: debits=${debits} credits=${credits}`;
  }
  return null;
}

/** Verify all built-in recipes are balanced. Returns a list of error strings. */
export function verifyAllRecipes(): string[] {
  const errors: string[] = [];
  for (const [name, recipe] of [
    ['DEPOSIT_RECIPE', DEPOSIT_RECIPE],
    ['RECOGNIZE_RECIPE', RECOGNIZE_RECIPE],
    ['COMMISSION_RECIPE', COMMISSION_RECIPE],
    ['PAYOUT_RECIPE', PAYOUT_RECIPE],
  ] as const) {
    const err = verifyRecipe(recipe);
    if (err) errors.push(`${name}: ${err}`);
  }
  return errors;
}
