// DynamicPricingEngine — Price optimization and demand forecasting
// Moat 4: 3-year competitive advantage through autonomous pricing intelligence
// All calculations are deterministic and auditable. No external API dependencies.

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PriceRecommendation {
  resourceId: string;
  currentPriceCents: number;
  recommendedPriceCents: number;
  confidenceLow: number;
  confidenceHigh: number;
  reasoning: string[];
  expectedDemand: number;
}

export interface HistoricalDeal {
  dealId: string;
  resourceId: string;
  priceCents: number;
  completed: boolean;
  bookedAt: string; // ISO date string
  artistId?: string;
  venueId?: string;
  artistPopularity?: number; // 0-1 scale
  venuePopularity?: number; // 0-1 scale
}

export interface DemandForecast {
  date: string;
  forecast: number;
  ci: [number, number]; // 80% confidence interval
}

export interface PricePointAnalysis {
  priceCents: number;
  dealCount: number;
  completionRate: number;
  revenueYield: number; // expected revenue per deal at this price
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const SEASONALITY_WEIGHTS: Record<string, number> = {
  // Month-based: higher weight = more demand
  '01': 0.70, '02': 0.75, '03': 0.90,
  '04': 0.95, '05': 1.05, '06': 1.15,
  '07': 1.10, '08': 1.05, '09': 1.00,
  '10': 0.95, '11': 0.85, '12': 0.80,
};

const WEEKEND_BOOST = 1.15; // 15% boost on weekends
const WEEKDAY_FACTOR = 0.95; // slight reduction on weekdays

const MIN_PRICE_CENTS = 100; // $1.00 floor
const MAX_PRICE_FACTOR = 5.0; // Max 5x current price
const CONFIDENCE_Z_SCORE = 1.28; // 80% CI
const DEMAND_ALPHA = 0.3; // exponential smoothing factor
const MIN_DEALS_FOR_ANALYSIS = 5;

// ─── Utility ────────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Convert ISO date string to a stable numeric day index (days since epoch). */
function dateToDayIndex(isoDate: string): number {
  return Math.floor(new Date(isoDate).getTime() / (1000 * 60 * 60 * 24));
}

/** Get the day of week (0 = Sunday, 6 = Saturday) from an ISO date string. */
function getDow(isoDate: string): number {
  return new Date(isoDate).getDay();
}

/** Get the month key ("01"-"12") from an ISO date string. */
function getMonthKey(isoDate: string): string {
  const m = new Date(isoDate).getMonth() + 1;
  return String(m).padStart(2, '0');
}

// ─── DynamicPricingEngine ───────────────────────────────────────────────────────

export class DynamicPricingEngine {
  /**
   * Recommend an optimal price for a resource based on historical deal data.
   *
   * @param resourceId - The resource (listing, booking slot, etc.) to price.
   * @param resourceType - Category (e.g. 'booking', 'listing') for context.
   * @param historicalDeals - Completed and uncompleted historical deals for this
   *   resource or comparable resources.
   * @param currentPriceCents - The currently listed price (can be 0 if unlisted).
   */
  recommendPrice(
    resourceId: string,
    resourceType: string,
    historicalDeals: HistoricalDeal[],
    currentPriceCents: number = 0,
  ): PriceRecommendation {
    const reasoning: string[] = [];
    const completed = historicalDeals.filter(d => d.completed);
    const allDeals = historicalDeals.length > 0 ? historicalDeals : completed;

    // ── Edge cases ─────────────────────────────────────────────────────────
    if (allDeals.length < MIN_DEALS_FOR_ANALYSIS) {
      reasoning.push(`Insufficient deal data (${allDeals.length} < ${MIN_DEALS_FOR_ANALYSIS}). Using current price as baseline.`);
      const fallbackPrice = currentPriceCents > 0 ? currentPriceCents : 5_000; // default $50
      return {
        resourceId,
        currentPriceCents,
        recommendedPriceCents: fallbackPrice,
        confidenceLow: Math.round(fallbackPrice * 0.7),
        confidenceHigh: Math.round(fallbackPrice * 1.3),
        reasoning,
        expectedDemand: 0,
      };
    }

    // ── Bucket deals by price point (rounded to nearest $5) ────────────────
    const bucketSize = 500; // $5 buckets
    const buckets = new Map<number, { total: number; completed: number }>();
    for (const deal of allDeals) {
      const bucket = Math.round(deal.priceCents / bucketSize) * bucketSize;
      const entry = buckets.get(bucket) || { total: 0, completed: 0 };
      entry.total++;
      if (deal.completed) entry.completed++;
      buckets.set(bucket, entry);
    }

    // ── Analyze price points ───────────────────────────────────────────────
    const pricePoints: PricePointAnalysis[] = [];
    for (const [priceCents, data] of buckets) {
      const completionRate = data.completed / data.total;
      const revenueYield = completionRate * priceCents;
      pricePoints.push({
        priceCents,
        dealCount: data.total,
        completionRate,
        revenueYield,
      });
    }

    // ── Determine seasonality factor ───────────────────────────────────────
    const recentDeal = allDeals.reduce((latest, d) =>
      d.bookedAt > latest.bookedAt ? d : latest, allDeals[0]);
    const monthKey = getMonthKey(recentDeal.bookedAt);
    const dow = getDow(recentDeal.bookedAt);
    const seasonalFactor = (SEASONALITY_WEIGHTS[monthKey] ?? 1.0);
    const dowFactor = (dow === 0 || dow === 6) ? WEEKEND_BOOST : WEEKDAY_FACTOR;
    const seasonalityMultiplier = seasonalFactor * dowFactor;
    reasoning.push(
      `Seasonality factor: ${seasonalityMultiplier.toFixed(3)} (month ${monthKey}=${seasonalFactor}, dow=${dow} factor=${dowFactor})`,
    );

    // ── Factor in artist/venue popularity ──────────────────────────────────
    let popularityBoost = 1.0;
    const avgArtistPop = mean(
      allDeals.filter(d => d.artistPopularity != null).map(d => d.artistPopularity!),
    );
    const avgVenuePop = mean(
      allDeals.filter(d => d.venuePopularity != null).map(d => d.venuePopularity!),
    );
    if (avgArtistPop > 0) {
      // Each 0.1 above baseline 0.5 adds 5% to recommended price
      popularityBoost += (avgArtistPop - 0.5) * 0.5;
      reasoning.push(`Artist popularity: ${avgArtistPop.toFixed(2)} (boost: ${((avgArtistPop - 0.5) * 0.5).toFixed(3)})`);
    }
    if (avgVenuePop > 0) {
      popularityBoost += (avgVenuePop - 0.5) * 0.3;
      reasoning.push(`Venue popularity: ${avgVenuePop.toFixed(2)} (boost: ${((avgVenuePop - 0.5) * 0.3).toFixed(3)})`);
    }
    popularityBoost = clamp(popularityBoost, 0.5, 2.0);

    // ── Find optimal price (max expected revenue yield) ────────────────────
    // Sort by revenue yield descending
    pricePoints.sort((a, b) => b.revenueYield - a.revenueYield);

    const optimalPricePoint = pricePoints[0];
    const completionRateWeight = optimalPricePoint.completionRate;

    if (optimalPricePoint) {
      reasoning.push(
        `Optimal price point: $${(optimalPricePoint.priceCents / 100).toFixed(2)} ` +
        `(${optimalPricePoint.dealCount} deals, ${(optimalPricePoint.completionRate * 100).toFixed(0)}% completion)`,
      );
    }

    // ── Compute recommended price ──────────────────────────────────────────
    const basePrice = optimalPricePoint.priceCents;
    const recommended = Math.round(
      clamp(
        basePrice * seasonalityMultiplier * popularityBoost,
        MIN_PRICE_CENTS,
        (currentPriceCents > 0 ? currentPriceCents : basePrice) * MAX_PRICE_FACTOR,
      ),
    );

    // ── Confidence interval from completion rate stability ─────────────────
    const completionRates = pricePoints.map(p => p.completionRate);
    const rateStddev = stddev(completionRates);
    // Wider stddev in completion rate = wider price CI
    const ciWidth = rateStddev > 0
      ? recommended * rateStddev * CONFIDENCE_Z_SCORE
      : recommended * 0.1;

    const confidenceLow = Math.round(clamp(recommended - ciWidth, MIN_PRICE_CENTS, recommended));
    const confidenceHigh = Math.round(recommended + ciWidth);

    reasoning.push(
      `Confidence: ±${Math.round(rateStddev * 100)}% completion rate stddev → CI [$${(confidenceLow / 100).toFixed(2)}, $${(confidenceHigh / 100).toFixed(2)}]`,
    );

    // ── Expected demand ────────────────────────────────────────────────────
    const expectedDemand = Math.round(
      completionRateWeight * allDeals.length * seasonalityMultiplier,
    );
    reasoning.push(`Expected demand at recommended price: ${expectedDemand} bookings`);

    return {
      resourceId,
      currentPriceCents,
      recommendedPriceCents: recommended,
      confidenceLow,
      confidenceHigh,
      reasoning,
      expectedDemand,
    };
  }

  /**
   * Forecast booking demand for a vertical over the next N days.
   * Uses simple exponential smoothing on historical booking counts.
   *
   * @param vertical - The booking vertical/category to forecast.
   * @param historicalBookings - Array of booking records with dates.
   * @param horizonDays - Number of days to forecast (default 30).
   */
  forecastDemand(
    vertical: string,
    historicalBookings: Array<{ date: string; count: number }>,
    horizonDays: number = 30,
  ): DemandForecast[] {
    if (historicalBookings.length === 0) {
      return this.emptyForecast(horizonDays);
    }

    // ── Build a daily time series ──────────────────────────────────────────
    const sorted = [...historicalBookings].sort((a, b) => a.date.localeCompare(b.date));
    const startDay = dateToDayIndex(sorted[0].date);
    const endDay = dateToDayIndex(sorted[sorted.length - 1].date);

    // Fill in missing days with 0
    const dailySeries: number[] = [];
    const dailyDates: string[] = [];
    const countByDay = new Map<number, number>();
    for (const b of sorted) {
      const day = dateToDayIndex(b.date);
      countByDay.set(day, (countByDay.get(day) ?? 0) + b.count);
    }

    for (let d = startDay; d <= endDay; d++) {
      dailySeries.push(countByDay.get(d) ?? 0);
      const date = new Date(d * 1000 * 60 * 60 * 24);
      dailyDates.push(date.toISOString().slice(0, 10));
    }

    // ── Simple exponential smoothing ───────────────────────────────────────
    let smoothed = dailySeries[0];
    const fitted: number[] = [smoothed];
    for (let i = 1; i < dailySeries.length; i++) {
      smoothed = DEMAND_ALPHA * dailySeries[i] + (1 - DEMAND_ALPHA) * smoothed;
      fitted.push(smoothed);
    }

    // ── Compute residuals for CI ───────────────────────────────────────────
    const residuals: number[] = [];
    for (let i = 0; i < dailySeries.length; i++) {
      residuals.push(dailySeries[i] - fitted[i]);
    }
    const residualStd = stddev(residuals);

    // ── Apply seasonality and day-of-week pattern ──────────────────────────
    // Compute average seasonal factor for the forecast period
    const forecastStartDay = endDay + 1;

    // Build a day-of-week pattern from historical data
    const dowAvg = [0, 0, 0, 0, 0, 0, 0];
    const dowCount = [0, 0, 0, 0, 0, 0, 0];
    for (const b of sorted) {
      const dow = getDow(b.date);
      dowAvg[dow] += b.count;
      dowCount[dow]++;
    }
    for (let i = 0; i < 7; i++) {
      dowAvg[i] = dowCount[i] > 0 ? dowAvg[i] / dowCount[i] : 0;
    }
    const overallDaily = mean(dowAvg.filter(v => v > 0)) || 1;
    const dowFactors = dowAvg.map(v => (v > 0 ? v / overallDaily : 1));

    // ── Forecast ───────────────────────────────────────────────────────────
    const forecast: DemandForecast[] = [];
    const lastLevel = fitted[fitted.length - 1];

    for (let i = 0; i < horizonDays; i++) {
      const day = forecastStartDay + i;
      const date = new Date(day * 1000 * 60 * 60 * 24);
      const dateStr = date.toISOString().slice(0, 10);
      const dow = date.getDay();

      // Get month key from the date string
      const actualMonthKey = getMonthKey(dateStr);
      const seasonFactor = (SEASONALITY_WEIGHTS[actualMonthKey] ?? 1.0);
      const dayFactor = dowFactors[dow];

      const trendFactor = 1.0; // SES doesn't model trend; keep flat level
      const raw = lastLevel * seasonFactor * dayFactor * trendFactor;
      const forecastVal = Math.round(Math.max(0, raw));

      const ciMargin = CONFIDENCE_Z_SCORE * residualStd * Math.sqrt(i + 1); // widening CI
      forecast.push({
        date: dateStr,
        forecast: forecastVal,
        ci: [
          Math.round(Math.max(0, forecastVal - ciMargin)),
          Math.round(forecastVal + ciMargin),
        ],
      });
    }

    return forecast;
  }

  /**
   * Analyze completion rate distribution for a vertical — useful for dashboards.
   */
  analyzePriceElasticity(
    deals: HistoricalDeal[],
    bucketSizeCents: number = 500,
  ): PricePointAnalysis[] {
    const buckets = new Map<number, { total: number; completed: number }>();
    for (const deal of deals) {
      const bucket = Math.round(deal.priceCents / bucketSizeCents) * bucketSizeCents;
      const entry = buckets.get(bucket) || { total: 0, completed: 0 };
      entry.total++;
      if (deal.completed) entry.completed++;
      buckets.set(bucket, entry);
    }

    const analysis: PricePointAnalysis[] = [];
    for (const [priceCents, data] of buckets) {
      analysis.push({
        priceCents,
        dealCount: data.total,
        completionRate: data.completed / data.total,
        revenueYield: (data.completed / data.total) * priceCents,
      });
    }

    return analysis.sort((a, b) => a.priceCents - b.priceCents);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private emptyForecast(horizonDays: number): DemandForecast[] {
    const result: DemandForecast[] = [];
    const today = new Date();
    for (let i = 0; i < horizonDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      result.push({
        date: date.toISOString().slice(0, 10),
        forecast: 0,
        ci: [0, 0],
      });
    }
    return result;
  }
}