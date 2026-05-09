// Usage forecasting — predict future API consumption from historical patterns
export interface UsageForecast {
  tenantId: string;
  metric: string;
  currentValue: number;
  projected30d: number;
  projected90d: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  confidence: number;
  generatedAt: string;
}

interface DataPoint { date: string; value: number; }

const history = new Map<string, DataPoint[]>();
const MAX_POINTS = 365;

export const usageForecast = {
  record(tenantId: string, metric: string, value: number): void {
    const key = `${tenantId}:${metric}`;
    const points = history.get(key) ?? [];
    points.push({ date: new Date().toISOString().slice(0, 10), value });
    if (points.length > MAX_POINTS) points.shift();
    history.set(key, points);
  },

  forecast(tenantId: string, metric: string): UsageForecast | null {
    const key = `${tenantId}:${metric}`;
    const points = history.get(key) ?? [];
    if (points.length < 3) return null;

    // Simple linear regression on daily values
    const n = points.length;
    const xs = points.map((_, i) => i);
    const ys = points.map(p => p.value);
    const meanX = xs.reduce((a, b) => a + b) / n;
    const meanY = ys.reduce((a, b) => a + b) / n;

    const num = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);
    const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
    const slope = den > 0 ? num / den : 0;
    const intercept = meanY - slope * meanX;

    const current = ys[ys.length - 1];
    const projected30d = Math.max(0, slope * (n + 30) + intercept);
    const projected90d = Math.max(0, slope * (n + 90) + intercept);

    const r2 = den > 0 ? 1 - ys.reduce((s, y, i) => s + (y - (slope * xs[i] + intercept)) ** 2, 0) / ys.reduce((s, y) => s + (y - meanY) ** 2, 0) : 0;

    let trend: 'increasing' | 'stable' | 'decreasing';
    const changePct = current > 0 ? (projected30d - current) / current * 100 : 0;
    if (changePct > 10) trend = 'increasing';
    else if (changePct < -10) trend = 'decreasing';
    else trend = 'stable';

    return {
      tenantId, metric, currentValue: current,
      projected30d: Math.round(projected30d), projected90d: Math.round(projected90d),
      trend, confidence: Math.round(Math.max(0, Math.min(1, r2)) * 100),
      generatedAt: new Date().toISOString(),
    };
  },

  listForecasts(tenantId: string): UsageForecast[] {
    const metrics = new Set<string>();
    for (const [key] of history) {
      const [tid, metric] = key.split(':');
      if (tid === tenantId) metrics.add(metric);
    }
    return [...metrics].map(m => this.forecast(tenantId, m)).filter(Boolean) as UsageForecast[];
  },
};
