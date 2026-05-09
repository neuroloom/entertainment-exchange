// Rate limit simulator — dry-run rate limit checks without enforcement
export interface SimulationResult {
  endpoint: string;
  currentRpm: number;
  limitRpm: number;
  utilizationPct: number;
  wouldBeLimited: boolean;
  projectedExhaustionIn: number; // seconds until limit hit at current rate
  recommendation: string;
}

export const rateLimitSimulator = {
  simulate(tenantId: string, rpm: number, limitRpm: number, concurrency: number): SimulationResult {
    const utilizationPct = Math.round(rpm / limitRpm * 100);
    const wouldBeLimited = rpm >= limitRpm;
    const headroom = limitRpm - rpm;
    const projectedExhaustionIn = concurrency > 0 ? Math.round(headroom / (concurrency / 60)) : 9999;

    let recommendation: string;
    if (utilizationPct > 90) recommendation = `CRITICAL: At ${utilizationPct}% of limit. Increase limit or reduce traffic immediately.`;
    else if (utilizationPct > 75) recommendation = `WARNING: Approaching limit. Consider scaling up or optimizing calls.`;
    else if (utilizationPct > 50) recommendation = `Healthy but monitor. ${headroom} RPM headroom remaining.`;
    else recommendation = `Well within limits. ${headroom} RPM headroom available.`;

    return {
      endpoint: 'simulated', currentRpm: rpm, limitRpm,
      utilizationPct, wouldBeLimited, projectedExhaustionIn, recommendation,
    };
  },

  whatIf(tenantId: string, currentRpm: number, growthPct: number, limitRpm: number): Array<{ daysOut: number; projectedRpm: number; wouldExceed: boolean }> {
    const projections: Array<{ daysOut: number; projectedRpm: number; wouldExceed: boolean }> = [];
    const growthFactor = 1 + growthPct / 100;

    for (const days of [7, 14, 30, 60, 90]) {
      const projected = Math.round(currentRpm * Math.pow(growthFactor, days));
      projections.push({ daysOut: days, projectedRpm: projected, wouldExceed: projected > limitRpm });
    }

    return projections;
  },

  capacityPlanning(tenantId: string, currentRpm: number, growthPct: number, limitRpm: number): { daysUntilExhaustion: number | null; recommendedLimit: number } {
    const growthFactor = 1 + growthPct / 100;

    let daysUntilExhaustion: number | null = null;
    for (let d = 1; d <= 365; d++) {
      if (currentRpm * Math.pow(growthFactor, d) > limitRpm) {
        daysUntilExhaustion = d;
        break;
      }
    }

    const projected90d = Math.round(currentRpm * Math.pow(growthFactor, 90));
    const recommendedLimit = Math.round(projected90d * 1.2); // 20% buffer

    return { daysUntilExhaustion, recommendedLimit };
  },
};
