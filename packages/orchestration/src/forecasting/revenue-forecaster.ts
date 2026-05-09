// Revenue Forecaster — projection engine using booking pipeline + journal history
// Models: weighted pipeline, linear regression on historical revenue, seasonal adjustment

export interface ForecastInput {
  confirmedBookings: Array<{ amountCents: number; eventDate: string }>;
  pipelineBookings: Array<{ amountCents: number; status: string; eventDate: string }>;
  journalEntries: Array<{ amountCents: number; direction: 'debit' | 'credit'; createdAt: string }>;
}

export interface MonthlyProjection {
  month: string;            // YYYY-MM
  projectedRevenue: number;  // cents
  confidence: number;        // 0-1
  lowerBound: number;        // cents — pessimistic
  upperBound: number;        // cents — optimistic
  pipelineWeight: number;    // contribution from pipeline (0-1)
  historicalWeight: number;  // contribution from history (0-1)
}

export interface ForecastResult {
  projections: MonthlyProjection[];
  annualProjection: number;
  annualConfidence: number;
  methodology: 'weighted_pipeline' | 'historical_regression' | 'blended';
}

const PIPE_CLOSE_RATES: Record<string, number> = {
  inquiry: 0.05,
  tentative: 0.20,
  confirmed: 1.0,
  contracted: 0.95,
  completed: 1.0,
};

function getMonth(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

export class RevenueForecaster {
  // Weighted pipeline: confirmed revenue + pipeline bookings × close rate
  forecastFromPipeline(input: ForecastInput, months = 6): ForecastResult {
    const now = new Date();
    const projections: MonthlyProjection[] = [];

    for (let i = 0; i < months; i++) {
      const target = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthStr = target.toISOString().slice(0, 7);
      let projected = 0;
      let count = 0;

      // Confirmed bookings for this month
      for (const b of input.confirmedBookings) {
        if (getMonth(b.eventDate) === monthStr) {
          projected += b.amountCents;
          count++;
        }
      }

      // Pipeline bookings weighted by close rate for this month
      let pipelineRev = 0;
      let pipelineWeight = 0;
      for (const b of input.pipelineBookings) {
        if (getMonth(b.eventDate) === monthStr) {
          const rate = PIPE_CLOSE_RATES[b.status] ?? 0.1;
          pipelineRev += b.amountCents * rate;
          pipelineWeight += rate;
          count++;
        }
      }

      const totalProjected = projected + pipelineRev;
      // Confidence based on data density and close-rate composition
      const confidence = count > 0 ? Math.min(1, 0.3 + (count * 0.1)) : 0.3;
      // Variance: tighter for confirmed-only months, wider for pipeline
      const variance = pipelineWeight > 0 ? 0.25 : 0.1;

      projections.push({
        month: monthStr,
        projectedRevenue: totalProjected,
        confidence,
        lowerBound: Math.round(totalProjected * (1 - variance)),
        upperBound: Math.round(totalProjected * (1 + variance)),
        pipelineWeight: projected > 0 ? pipelineRev / totalProjected : 1,
        historicalWeight: 0,
      });
    }

    const annual = projections.slice(0, 12).reduce((s, p) => s + p.projectedRevenue, 0);
    const avgConfidence = projections.reduce((s, p) => s + p.confidence, 0) / projections.length;

    return { projections, annualProjection: annual, annualConfidence: avgConfidence, methodology: 'weighted_pipeline' };
  }

  // Historical regression: simple linear fit on monthly revenue history
  forecastFromHistory(input: ForecastInput, months = 6): ForecastResult {
    const monthlyRevenue = new Map<string, number>();

    for (const e of input.journalEntries) {
      if (e.direction !== 'credit') continue;
      const month = getMonth(e.createdAt);
      monthlyRevenue.set(month, (monthlyRevenue.get(month) ?? 0) + e.amountCents);
    }

    const sorted = [...monthlyRevenue.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (sorted.length < 2) {
      // Not enough history — fall back to simple average
      return this.forecastFromPipeline(input, months);
    }

    // Simple linear regression: y = mx + b on monthly data
    const n = sorted.length;
    const xs = sorted.map((_, i) => i);
    const ys = sorted.map(([, v]) => v);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);
    const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
    const slope = den > 0 ? num / den : 0;
    const intercept = meanY - slope * meanX;

    // R² for confidence
    const ssRes = ys.reduce((s, y, i) => s + (y - (slope * xs[i] + intercept)) ** 2, 0);
    const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const now = new Date();
    const projections: MonthlyProjection[] = [];
    for (let i = 0; i < months; i++) {
      const target = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthStr = target.toISOString().slice(0, 7);
      const xi = n + i; // Project forward
      const projected = Math.max(0, slope * xi + intercept);
      const variance = 0.2 * (1 - Math.min(0.9, r2));

      projections.push({
        month: monthStr,
        projectedRevenue: Math.round(projected),
        confidence: Math.max(0.1, Math.min(0.95, r2)),
        lowerBound: Math.round(projected * (1 - variance)),
        upperBound: Math.round(projected * (1 + variance)),
        pipelineWeight: 0,
        historicalWeight: 1,
      });
    }

    const annual = projections.reduce((s, p) => s + p.projectedRevenue, 0);
    const avgConf = projections.reduce((s, p) => s + p.confidence, 0) / projections.length;

    return { projections, annualProjection: annual, annualConfidence: avgConf, methodology: 'historical_regression' };
  }

  // Blended: weighted mix of pipeline and historical, preferring whichever has higher confidence
  forecastBlended(input: ForecastInput, months = 6): ForecastResult {
    const pipe = this.forecastFromPipeline(input, months);
    const hist = this.forecastFromHistory(input, months);

    // Weight by confidence³ to favor the more reliable method
    const pipeWeight = pipe.annualConfidence ** 3 / (pipe.annualConfidence ** 3 + hist.annualConfidence ** 3 + 0.001);
    const histWeight = 1 - pipeWeight;

    const projections: MonthlyProjection[] = [];
    for (let i = 0; i < months; i++) {
      const p = pipe.projections[i];
      const h = hist.projections[i];
      projections.push({
        month: p.month,
        projectedRevenue: Math.round(p.projectedRevenue * pipeWeight + h.projectedRevenue * histWeight),
        confidence: p.confidence * pipeWeight + h.confidence * histWeight,
        lowerBound: Math.round(p.lowerBound * pipeWeight + h.lowerBound * histWeight),
        upperBound: Math.round(p.upperBound * pipeWeight + h.upperBound * histWeight),
        pipelineWeight: pipeWeight,
        historicalWeight: histWeight,
      });
    }

    const annual = projections.reduce((s, p) => s + p.projectedRevenue, 0);
    const avgConf = projections.reduce((s, p) => s + p.confidence, 0) / projections.length;

    return { projections, annualProjection: annual, annualConfidence: avgConf, methodology: 'blended' };
  }
}
