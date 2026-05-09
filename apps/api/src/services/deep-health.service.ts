// Deep health check — comprehensive dependency verification with latency breakdown
export interface HealthStatus {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number;
  error?: string;
  lastChecked: string;
}

export interface DeepHealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthStatus[];
  uptime: number; // seconds since process start
  memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
}

const processStart = Date.now();

interface HealthChecker {
  name: string;
  check: () => Promise<{ ok: boolean; error?: string }>;
}

const checkers: HealthChecker[] = [];

export const deepHealth = {
  registerChecker(name: string, check: () => Promise<{ ok: boolean; error?: string }>): void {
    checkers.push({ name, check });
  },

  async runAll(): Promise<DeepHealthReport> {
    const checks: HealthStatus[] = [];
    const now = new Date().toISOString();

    // Run all registered checkers + built-in memory check
    for (const checker of checkers) {
      const start = Date.now();
      try {
        const result = await checker.check();
        checks.push({
          service: checker.name,
          status: result.ok ? 'ok' : 'degraded',
          latencyMs: Date.now() - start,
          error: result.error,
          lastChecked: now,
        });
      } catch (err) {
        checks.push({
          service: checker.name,
          status: 'down',
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : 'Unknown error',
          lastChecked: now,
        });
      }
    }

    // Memory check
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100;
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100;
    const rssMB = Math.round(mem.rss / 1024 / 1024 * 100) / 100;

    checks.push({
      service: 'memory',
      status: heapUsedMB / heapTotalMB > 0.9 ? 'degraded' : 'ok',
      latencyMs: 0, lastChecked: now,
    });

    // Determine overall status
    const downCount = checks.filter(c => c.status === 'down').length;
    const degradedCount = checks.filter(c => c.status === 'degraded').length;

    let overall: DeepHealthReport['overall'];
    if (downCount > 0) overall = 'unhealthy';
    else if (degradedCount > 0) overall = 'degraded';
    else overall = 'healthy';

    return {
      overall, timestamp: now, checks,
      uptime: Math.floor((Date.now() - processStart) / 1000),
      memory: { heapUsedMB, heapTotalMB, rssMB },
    };
  },
};
