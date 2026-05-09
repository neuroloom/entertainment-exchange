// Connection pool metrics — track database connection health and usage
interface PoolSnapshot {
  timestamp: string;
  active: number;
  idle: number;
  waiting: number;
  total: number;
  max: number;
}

const snapshots: PoolSnapshot[] = [];
const MAX_SNAPSHOTS = 1440; // 24h at 1/min

export const poolMetrics = {
  record(active: number, idle: number, waiting: number, total: number, max: number): void {
    snapshots.push({ timestamp: new Date().toISOString(), active, idle, waiting, total, max });
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
  },

  getLatest(): PoolSnapshot | null {
    return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  },

  getHistory(minutes = 60): PoolSnapshot[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return snapshots.filter(s => new Date(s.timestamp).getTime() > cutoff);
  },

  getUtilization(minutes = 15): { avgActivePct: number; peakActive: number; peakTime?: string } {
    const recent = this.getHistory(minutes);
    if (recent.length === 0) return { avgActivePct: 0, peakActive: 0 };

    let maxActive = 0;
    let peakTime: string | undefined;
    let totalPct = 0;

    for (const s of recent) {
      const pct = s.max > 0 ? (s.active / s.max) * 100 : 0;
      totalPct += pct;
      if (s.active > maxActive) { maxActive = s.active; peakTime = s.timestamp; }
    }

    return { avgActivePct: Math.round(totalPct / recent.length * 10) / 10, peakActive: maxActive, peakTime };
  },

  shouldWarn(): { warn: boolean; message?: string } {
    const latest = this.getLatest();
    if (!latest) return { warn: false };
    const pct = latest.max > 0 ? (latest.active / latest.max) * 100 : 0;
    if (pct > 90) return { warn: true, message: `Connection pool at ${Math.round(pct)}% — near capacity` };
    if (latest.waiting > 0) return { warn: true, message: `${latest.waiting} requests waiting for connections` };
    return { warn: false };
  },
};
