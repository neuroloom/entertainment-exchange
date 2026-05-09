// Error budget — SRE error budget tracking and burn rate monitoring
export interface ErrorBudget {
  tenantId: string;
  period: string;           // YYYY-MM
  targetSlo: number;        // e.g., 99.9
  totalRequests: number;
  errorCount: number;
  budgetTotal: number;      // Allowed errors
  budgetRemaining: number;
  budgetUsedPct: number;
  burnRate: number;         // Multiplier of sustainable rate
  status: 'healthy' | 'warning' | 'critical' | 'exhausted';
}

const monthlyStats = new Map<string, { requests: number; errors: number }>();

export const errorBudget = {
  recordRequest(tenantId: string, isError: boolean): void {
    const monthKey = new Date().toISOString().slice(0, 7);
    const key = `${tenantId}:${monthKey}`;
    const stats = monthlyStats.get(key) ?? { requests: 0, errors: 0 };
    stats.requests++;
    if (isError) stats.errors++;
    monthlyStats.set(key, stats);
  },

  getBudget(tenantId: string, targetSlo = 99.9): ErrorBudget {
    const monthKey = new Date().toISOString().slice(0, 7);
    const key = `${tenantId}:${monthKey}`;
    const stats = monthlyStats.get(key) ?? { requests: 0, errors: 0 };

    const errorRate = 1 - targetSlo / 100;
    const budgetTotal = Math.round(stats.requests * errorRate) || 1;
    const budgetRemaining = Math.max(0, budgetTotal - stats.errors);
    const budgetUsedPct = Math.round(stats.errors / budgetTotal * 100);

    // Burn rate: how fast we're consuming budget relative to linear
    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const expectedBurn = dayOfMonth / daysInMonth;
    const actualBurn = budgetTotal > 0 ? stats.errors / budgetTotal : 0;
    const burnRate = expectedBurn > 0 ? actualBurn / expectedBurn : 0;

    let status: ErrorBudget['status'];
    if (budgetRemaining === 0) status = 'exhausted';
    else if (burnRate > 2) status = 'critical';
    else if (burnRate > 1) status = 'warning';
    else status = 'healthy';

    return {
      tenantId, period: monthKey, targetSlo, totalRequests: stats.requests,
      errorCount: stats.errors, budgetTotal, budgetRemaining, budgetUsedPct,
      burnRate: Math.round(burnRate * 100) / 100, status,
    };
  },

  getHistory(tenantId: string, months = 6): ErrorBudget[] {
    const results: ErrorBudget[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = d.toISOString().slice(0, 7);
      const key = `${tenantId}:${monthKey}`;
      const stats = monthlyStats.get(key) ?? { requests: 0, errors: 0 };

      results.push({
        tenantId, period: monthKey, targetSlo: 99.9,
        totalRequests: stats.requests, errorCount: stats.errors,
        budgetTotal: Math.round(stats.requests * 0.001) || 1,
        budgetRemaining: Math.max(0, Math.round(stats.requests * 0.001) - stats.errors),
        budgetUsedPct: stats.requests > 0 ? Math.round(stats.errors / (Math.round(stats.requests * 0.001) || 1) * 100) : 0,
        burnRate: 0, status: stats.errors > Math.round(stats.requests * 0.001) ? 'exhausted' : 'healthy',
      });
    }

    return results;
  },
};
