// Data quality scoring — completeness and accuracy metrics per domain
export interface QualityScore {
  domain: string;
  totalRecords: number;
  completenessPct: number;
  requiredFieldsPresent: number;
  requiredFieldsTotal: number;
  staleRecords: number;
  orphanedRecords: number;
  overallScore: number; // 0-100
}

interface QualityCheck { domain: string; requiredFields: string[]; };
const checks: QualityCheck[] = [
  { domain: 'businesses', requiredFields: ['id', 'tenantId', 'name', 'status', 'createdAt'] },
  { domain: 'bookings', requiredFields: ['id', 'tenantId', 'businessId', 'eventType', 'eventDate', 'startTime', 'endTime', 'status', 'createdAt'] },
  { domain: 'agents', requiredFields: ['id', 'tenantId', 'name', 'status', 'createdAt'] },
  { domain: 'listings', requiredFields: ['id', 'tenantId', 'title', 'listingType', 'status', 'createdAt'] },
];

export const dataQuality = {
  score(tenantId: string, domain: string, records: Record<string, unknown>[]): QualityScore {
    const check = checks.find(c => c.domain === domain);
    if (!check || records.length === 0) {
      return { domain, totalRecords: records.length, completenessPct: 100, requiredFieldsPresent: 0, requiredFieldsTotal: 0, staleRecords: 0, orphanedRecords: 0, overallScore: records.length === 0 ? 100 : 50 };
    }

    let requiredFieldsTotal = records.length * check.requiredFields.length;
    let requiredFieldsPresent = 0;
    let staleRecords = 0;

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    for (const r of records) {
      for (const f of check.requiredFields) {
        const val = r[f];
        if (val !== undefined && val !== null && val !== '') requiredFieldsPresent++;
      }
      const updated = r.updatedAt ?? r.createdAt;
      if (updated && new Date(String(updated)).getTime() < thirtyDaysAgo) staleRecords++;
    }

    const completenessPct = requiredFieldsTotal > 0 ? Math.round(requiredFieldsPresent / requiredFieldsTotal * 100) : 100;
    const stalenessPenalty = records.length > 0 ? Math.round(staleRecords / records.length * 20) : 0;
    const overallScore = Math.max(0, completenessPct - stalenessPenalty);

    return {
      domain, totalRecords: records.length, completenessPct,
      requiredFieldsPresent, requiredFieldsTotal, staleRecords,
      orphanedRecords: 0, overallScore,
    };
  },

  scoreAll(tenantId: string, data: Record<string, Record<string, unknown>[]>): QualityScore[] {
    return Object.entries(data).map(([domain, records]) => this.score(tenantId, domain, records));
  },

  getOverallHealth(scores: QualityScore[]): { avgScore: number; bestDomain: string; worstDomain: string; domainsBelow80: number } {
    if (scores.length === 0) return { avgScore: 100, bestDomain: '', worstDomain: '', domainsBelow80: 0 };

    const avg = Math.round(scores.reduce((s, sc) => s + sc.overallScore, 0) / scores.length);
    const sorted = [...scores].sort((a, b) => b.overallScore - a.overallScore);

    return {
      avgScore: avg,
      bestDomain: sorted[0].domain,
      worstDomain: sorted[sorted.length - 1].domain,
      domainsBelow80: scores.filter(s => s.overallScore < 80).length,
    };
  },
};
