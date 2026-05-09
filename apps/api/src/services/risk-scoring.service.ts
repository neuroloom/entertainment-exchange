// Tenant risk scoring — behavioral risk assessment from activity patterns
export interface RiskScore {
  tenantId: string;
  score: number;          // 0-100, higher = riskier
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: Array<{ name: string; score: number; weight: number }>;
  assessedAt: string;
}

interface RiskEvent { tenantId: string; type: string; weight: number; timestamp: string; }
const events: RiskEvent[] = [];
const MAX_EVENTS = 20_000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7-day window

const RISK_WEIGHTS: Record<string, number> = {
  auth_failure: 1,
  rate_limited: 2,
  unusual_hour: 3,
  geo_anomaly: 5,
  bulk_delete: 4,
  gdpr_export: 2,
  api_key_created: 1,
  quota_exceeded: 3,
  suspended: 10,
  ip_spoofing: 8,
};

export const riskScoring = {
  recordEvent(tenantId: string, type: string): void {
    events.push({ tenantId, type, weight: RISK_WEIGHTS[type] ?? 1, timestamp: new Date().toISOString() });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  },

  assess(tenantId: string): RiskScore {
    const cutoff = Date.now() - WINDOW_MS;
    const tenantEvents = events.filter(e => e.tenantId === tenantId && new Date(e.timestamp).getTime() > cutoff);

    const factorScores: Array<{ name: string; score: number; weight: number }> = [];
    let totalScore = 0;

    // Group by event type
    const byType: Record<string, { count: number; weight: number }> = {};
    for (const e of tenantEvents) {
      if (!byType[e.type]) byType[e.type] = { count: 0, weight: e.weight };
      byType[e.type].count++;
    }

    for (const [type, { count, weight }] of Object.entries(byType)) {
      const factorScore = Math.min(100, count * weight * 5);
      factorScores.push({ name: type, score: factorScore, weight });
      totalScore += factorScore * (weight / 10);
    }

    totalScore = Math.min(100, Math.round(totalScore));
    let level: RiskScore['level'];
    if (totalScore >= 80) level = 'critical';
    else if (totalScore >= 50) level = 'high';
    else if (totalScore >= 25) level = 'medium';
    else level = 'low';

    return { tenantId, score: totalScore, level, factors: factorScores.sort((a, b) => b.score - a.score), assessedAt: new Date().toISOString() };
  },

  getAllScores(): RiskScore[] {
    const tenantIds = new Set(events.map(e => e.tenantId));
    return [...tenantIds].map(id => this.assess(id)).sort((a, b) => b.score - a.score);
  },
};
