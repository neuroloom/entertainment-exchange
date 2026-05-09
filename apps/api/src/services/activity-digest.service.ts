// Activity digest — daily/weekly activity summaries for tenant review
export interface ActivityDigest {
  id: string;
  tenantId: string;
  period: 'daily' | 'weekly';
  periodStart: string;
  periodEnd: string;
  highlights: string[];
  stats: Record<string, number>;
  topItems: Record<string, string[]>;
  generatedAt: string;
}

const digests: ActivityDigest[] = [];

export const activityDigest = {
  generate(tenantId: string, period: 'daily' | 'weekly', stats: { newBookings: number; confirmedBookings: number; newListings: number; dealsClosed: number; revenue: number; apiCalls: number; newBusinesses: number; activeAgents: number }, highlights: string[], topItems: Record<string, string[]>): ActivityDigest {
    const now = new Date();
    const periodStart = period === 'daily'
      ? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const d: ActivityDigest = {
      id: crypto.randomUUID(), tenantId, period,
      periodStart, periodEnd: now.toISOString(),
      highlights, stats, topItems, generatedAt: now.toISOString(),
    };
    digests.push(d);
    return d;
  },

  list(tenantId: string, limit = 10): ActivityDigest[] {
    return digests.filter(d => d.tenantId === tenantId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, limit);
  },

  get(id: string, tenantId: string): ActivityDigest | undefined {
    return digests.find(d => d.id === id && d.tenantId === tenantId);
  },
};
