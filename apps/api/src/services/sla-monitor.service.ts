// SLA monitor — uptime and latency tracking against defined thresholds
export interface SlaConfig {
  tenantId: string;
  uptimeTarget: number;     // e.g., 99.9
  latencyP95Ms: number;     // p95 latency target in ms
  latencyP99Ms: number;     // p99 latency target in ms
  checkWindowMinutes: number;
}

export interface SlaWindow {
  start: string;
  end: string;
  totalRequests: number;
  errorCount: number;
  uptimePct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meetsUptime: boolean;
  meetsLatency: boolean;
}

interface RequestSample {
  tenantId: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
}

const samples: RequestSample[] = [];
const MAX_SAMPLES = 50_000;
const configs = new Map<string, SlaConfig>();

export const slaMonitor = {
  setConfig(c: SlaConfig): void { configs.set(c.tenantId, c); },
  getConfig(tenantId: string): SlaConfig {
    return configs.get(tenantId) ?? { tenantId, uptimeTarget: 99.9, latencyP95Ms: 500, latencyP99Ms: 1000, checkWindowMinutes: 60 };
  },

  record(tenantId: string, statusCode: number, durationMs: number): void {
    if (!tenantId) return;
    samples.push({ tenantId, statusCode, durationMs, timestamp: new Date().toISOString() });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  },

  getCurrentWindow(tenantId: string): SlaWindow | null {
    const config = this.getConfig(tenantId);
    const cutoff = Date.now() - config.checkWindowMinutes * 60 * 1000;
    const window = samples.filter(s => s.tenantId === tenantId && new Date(s.timestamp).getTime() > cutoff);
    if (window.length < 2) return null;

    const errors = window.filter(s => s.statusCode >= 500).length;
    const uptimePct = Math.round((1 - errors / window.length) * 10000) / 100;
    const sorted = [...window].sort((a, b) => a.durationMs - b.durationMs);
    const p50 = sorted[Math.floor(sorted.length * 0.5)].durationMs;
    const p95 = sorted[Math.floor(sorted.length * 0.95)].durationMs;
    const p99 = sorted[Math.floor(sorted.length * 0.99)].durationMs;
    const max = sorted[sorted.length - 1].durationMs;

    return {
      start: new Date(cutoff).toISOString(), end: new Date().toISOString(),
      totalRequests: window.length, errorCount: errors, uptimePct,
      p50Ms: p50, p95Ms: p95, p99Ms: p99, maxMs: max,
      meetsUptime: uptimePct >= config.uptimeTarget,
      meetsLatency: p95 <= config.latencyP95Ms && p99 <= config.latencyP99Ms,
    };
  },

  getDashboard(tenantId: string): { current: SlaWindow | null; config: SlaConfig } {
    return { current: this.getCurrentWindow(tenantId), config: this.getConfig(tenantId) };
  },
};
