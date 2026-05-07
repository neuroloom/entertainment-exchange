// Ledger module — double-entry accounting core
export { IdempotencyStore, idempotencyStore } from './idempotency.js';
export type { IdempotencyEntry } from './idempotency.js';

export {
  DEPOSIT_RECIPE,
  RECOGNIZE_RECIPE,
  COMMISSION_RECIPE,
  PAYOUT_RECIPE,
  getRecipeForEvent,
  verifyRecipe,
  verifyAllRecipes,
} from './revenue-recipes.js';
export type { RecipeEntry, RecipeResult, RevenueRecipe } from './revenue-recipes.js';

export { RevenueSchedule } from './revenue-schedule.js';
export type { ScheduledRecognition } from './revenue-schedule.js';
